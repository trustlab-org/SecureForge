import asyncio
import uuid
import logging
import importlib
import collections
from datetime import datetime
from typing import Dict, Optional, List
from enum import Enum

from bas_engine.repositories.simulation_repo import (
    SimulationRepository
)
from bas_engine.core.event_bus import EventBus
from bas_engine.models.simulation import (
    SimulationRequest,
    SimulationResult,
    SimulationStatus,
    AttackModuleResult,
    SimulationSummary
)
from bas_engine.detection.validation_engine import (
    DetectionValidationEngine
)
from bas_engine.core.recon.attack_recommender import (
    AttackRecommender
)

logger = logging.getLogger("secureforge.orchestrator")


class SimulationState(str, Enum):
    QUEUED    = "queued"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"
    CANCELLED = "cancelled"


# ─── Module variant mapping ────────────────────────────────────────────────
# Maps module_name -> (safe_module_path, safe_class_name, red_module_path, red_class_name)
# or a dict with boolean keys.
# This tells the orchestrator which file/class to load for safe vs. aggressive mode.
MODULE_VARIANT_MAP = {
    "privilege_escalation": {
        False: ("bas_engine.attack_modules.privilege_escalation_safe", "PrivEscModule"),
        True:  ("bas_engine.attack_modules.privilege_escalation_red", "PrivEscModule"),
    },
    "impact_sim": {
        False: ("bas_engine.attack_modules.impact_sim_safe", "ImpactSimModule"),
        True:  ("bas_engine.attack_modules.impact_sim_red", "ImpactSimModule"),
    },
    # Add other modules here if they have _safe/_red variants.
    # If a module is not listed, we will fall back to the original registry.
}


class AttackOrchestrator:
    def __init__(self, event_bus: EventBus):
        self.event_bus = event_bus
        self.repo = SimulationRepository()
        self._store: collections.OrderedDict = collections.OrderedDict()
        self._STORE_MAX = 100  # evict oldest when cap is hit

        self._tasks: Dict[str, asyncio.Task] = {}
        self._semaphore = asyncio.Semaphore(5)
        self.validation_engine = DetectionValidationEngine()
        logger.info("AttackOrchestrator initialized")

    async def launch(self, request: SimulationRequest, role: str = "Operator") -> SimulationResult:
        if request.detailed_enumeration and role != "Administrator":
            raise ValueError("Administrator privileges required to launch red team modules.")

        sim_id = str(uuid.uuid4())
        now = datetime.utcnow()

        meta = dict(request.metadata or {})
        if "options" not in meta:
            meta["options"] = request.options or {}
        if "parallel" not in meta:
            meta["parallel"] = getattr(request, "parallel", False)
        if "autonomous" not in meta:
            meta["autonomous"] = getattr(request, "autonomous", False)
        if "detailed_enumeration" not in meta:
            meta["detailed_enumeration"] = getattr(request, "detailed_enumeration", False)

        result = SimulationResult(
            id=sim_id,
            name=request.name,
            target=request.target,
            modules=request.modules,
            status=SimulationState.QUEUED,
            created_at=now,
            updated_at=now,
            module_results=[],
            metadata=meta
        )

        self._store[sim_id] = result
        # Evict oldest entry if cap is exceeded
        while len(self._store) > self._STORE_MAX:
            self._store.popitem(last=False)
        await self.repo.create_simulation(result)


        # ----------------------------------------
        # DISPATCH TO CELERY
        # ----------------------------------------
        try:
            from bas_engine.worker import run_simulation_task
            req_data = request.dict() if hasattr(request, "dict") else request.model_dump()
            run_simulation_task.delay(sim_id, req_data, role)
        except (ImportError, Exception) as e:
            logger.warning(f"Celery task dispatch skipped or unavailable ({e}); queued simulation directly.")

        await self.event_bus.publish(
            "simulation.queued",
            {
                "id": sim_id,
                "name": request.name
            }
        )

        return result

    def get(self, sim_id: str) -> Optional[SimulationResult]:
        return self._store.get(sim_id)

    async def list_all(self) -> List[SimulationResult]:
        return await self.repo.list_simulations()

    async def summary(self) -> SimulationSummary:
        results = await self.repo.list_simulations()
        return SimulationSummary(
            total=len(results),
            queued=sum(1 for r in results if r.status == SimulationState.QUEUED),
            running=sum(1 for r in results if r.status == SimulationState.RUNNING),
            completed=sum(1 for r in results if r.status == SimulationState.COMPLETED),
            failed=sum(1 for r in results if r.status == SimulationState.FAILED),
        )

    async def _run_simulation(
        self,
        sim_id: str,
        request: SimulationRequest
    ):
        async with self._semaphore:
            if sim_id in self._store:
                result = self._store[sim_id]
            else:
                db_sim = await self.repo.get_simulation(sim_id)
                if not db_sim:
                    raise ValueError(f"Simulation {sim_id} not found in database.")
                result = db_sim
                self._store[sim_id] = result

            result.status = SimulationState.RUNNING
            result.started_at = datetime.utcnow()
            result.updated_at = datetime.utcnow()
            await self.repo.update_simulation(result)

            await self.event_bus.publish(
                "simulation.started",
                {
                    "id": sim_id,
                    "target": request.target
                }
            )

            try:
                # ----------------------------------------
                # AUTONOMOUS EXECUTION LOOP
                # ----------------------------------------
                modules_to_run = list(request.modules)
                executed_modules = set()
                recommender = AttackRecommender()
                result.module_results = []
                all_findings = []

                while modules_to_run:
                    logger.info(f"Orchestrator loop starting batch: {modules_to_run}")

                    module_tasks = [
                        self._run_module(
                            sim_id,
                            request.target,
                            m,
                            request.options,
                            request.detailed_enumeration
                        )
                        for m in modules_to_run
                    ]

                    # ----------------------------------------
                    # PARALLEL / SEQUENTIAL EXECUTION
                    # ----------------------------------------
                    if request.parallel:
                        module_results = await asyncio.gather(
                            *module_tasks,
                            return_exceptions=True
                        )
                    else:
                        module_results = []
                        for t in module_tasks:
                            module_results.append(await t)

                    # ----------------------------------------
                    # STORE MODULE RESULTS
                    # ----------------------------------------
                    for r in module_results:
                        if isinstance(r, Exception):
                            logger.error(f"Module execution error: {r}")
                            continue

                        result.module_results.append(r)
                        logger.debug(f"=== MODULE RESULT: {r.module} ===")
                        logger.debug(f"Findings: {len(r.findings)}")

                        for finding in r.findings:
                            if hasattr(finding, "model_dump"):
                                f = finding.model_dump()
                            else:
                                f = finding.dict()

                            all_findings.append({
                                "mitre_id": f.get("mitre_id"),
                                "severity": str(f.get("severity")),
                                "title": f.get("title")
                            })

                    # Mark current batch as executed
                    executed_modules.update(modules_to_run)
                    modules_to_run = []

                    # If autonomous mode is on, check for new recommended modules
                    if getattr(request, 'autonomous', False):
                        new_recommendations = set()
                        from bas_engine.attack_modules.registry import MODULE_REGISTRY

                        # Look at findings from the *current batch* only
                        for r in module_results:
                            if isinstance(r, Exception): continue
                            for finding in r.findings:
                                if finding.raw_data and "open_ports" in finding.raw_data:
                                    for port in finding.raw_data["open_ports"]:
                                        recs = recommender.recommend_by_port(port)
                                        for rec in recs:
                                            # Only add if it's a real module and we haven't run it yet
                                            if rec in MODULE_REGISTRY and rec not in executed_modules:
                                                new_recommendations.add(rec)
                                elif finding.raw_data and "port" in finding.raw_data:
                                    # Single port finding format
                                    port = finding.raw_data["port"]
                                    recs = recommender.recommend_by_port(port)
                                    for rec in recs:
                                        if rec in MODULE_REGISTRY and rec not in executed_modules:
                                            new_recommendations.add(rec)

                        if new_recommendations:
                            modules_to_run = list(new_recommendations)
                            logger.info(f"Autonomous Mode triggered new modules: {modules_to_run}")

                # ----------------------------------------
                # RUN DETECTION VALIDATION
                # ----------------------------------------
                logger.debug("=== FINDINGS SENT TO VALIDATION ===")
                logger.debug(all_findings)

                validation = self.validation_engine.validate(all_findings, list(executed_modules))

                logger.debug("=== VALIDATION RESULT ===")
                logger.debug(validation)

                # ----------------------------------------
                # STORE VALIDATION
                # ----------------------------------------
                result.metadata["detection_validation"] = validation

                # ----------------------------------------
                # COMPLETE
                # ----------------------------------------
                has_errors = any(r.status == "error" for r in result.module_results)
                is_unreachable = any(
                    "unreachable" in f.title.lower() or "not reachable" in f.title.lower()
                    for r in result.module_results
                    for f in r.findings
                )
                
                if has_errors or is_unreachable:
                    result.status = SimulationState.FAILED
                else:
                    result.status = SimulationState.COMPLETED
                result.finished_at = datetime.utcnow()
                result.updated_at = datetime.utcnow()
                
                # Update modules list to include any autonomously launched modules
                result.modules = list(executed_modules)

                # ----------------------------------------
                # SAVE TO DATABASE
                # ----------------------------------------
                await self.repo.save_module_results(
                    sim_id,
                    result.module_results
                )
                await self.repo.update_simulation(result)

                await self.event_bus.publish(
                    "simulation.completed",
                    {
                        "id": sim_id
                    }
                )

            except Exception as exc:
                result.status = SimulationState.FAILED
                result.error = str(exc)
                result.finished_at = datetime.utcnow()
                result.updated_at = datetime.utcnow()

                await self.repo.update_simulation(result)

                await self.event_bus.publish(
                    "simulation.failed",
                    {
                        "id": sim_id,
                        "error": str(exc)
                    }
                )

    async def _run_module(
        self,
        sim_id: str,
        target: str,
        module_name: str,
        options: dict,
        detailed_enumeration: bool  # <-- NEW parameter
    ) -> AttackModuleResult:
        """
        Runs a single attack module.
        - If the module has a _safe / _red variant defined in MODULE_VARIANT_MAP,
          it imports the appropriate one based on detailed_enumeration.
        - Otherwise, it falls back to the original MODULE_REGISTRY.
        """
        # 1. Try to load a variant from the map
        variant_entry = MODULE_VARIANT_MAP.get(module_name)
        if variant_entry:
            module_path, class_name = variant_entry[detailed_enumeration]
            try:
                mod = importlib.import_module(module_path)
                module_cls = getattr(mod, class_name)
                logger.info(
                    f"Loading module {module_name} variant: "
                    f"{module_path}.{class_name} "
                    f"(detailed_enumeration={detailed_enumeration})"
                )
            except (ImportError, AttributeError) as e:
                logger.error(
                    f"Failed to import variant for {module_name}: {e}. "
                    "Falling back to registry."
                )
                module_cls = None
        else:
            # Fallback to the original registry (for modules without variants)
            from bas_engine.attack_modules.registry import MODULE_REGISTRY
            module_cls = MODULE_REGISTRY.get(module_name)

        if not module_cls:
            return AttackModuleResult(
                module=module_name,
                status="error",
                error=f"Module {module_name} not found"
            )

        # 2. Extract per-module options
        module_options = {}
        if isinstance(options, dict):
            module_options = options.get(module_name, {}) or {}

        # (Optional) still inject the flag in case the module wants it anyway
        module_options["detailed_enumeration"] = detailed_enumeration
        module_options["ssl_verify"] = options.get("ssl_verify", False)

        # 3. Instantiate and run
        module_instance = module_cls(
            target=target,
            options=module_options,
            sim_id=sim_id,
            event_bus=self.event_bus
        )

        await self.event_bus.publish(
            "module.started",
            {
                "sim_id": sim_id,
                "module": module_name
            }
        )

        mod_result = await module_instance.run()

        await self.event_bus.publish(
            "module.completed",
            {
                "sim_id": sim_id,
                "module": module_name,
                "findings_count": len(mod_result.findings)
            }
        )

        # Broadcast individual findings
        for finding in mod_result.findings:
            finding_data = (
                finding.model_dump()
                if hasattr(finding, "model_dump")
                else finding.dict()
            )

            await self.event_bus.publish(
                "vulnerability.found",
                {
                    "sim_id": sim_id,
                    "target": target,
                    "module": module_name,
                    "finding_details": finding_data
                }
            )

        return mod_result