import logging
from fastapi import APIRouter, Request, HTTPException
from bas_engine.models.simulation import SimulationRequest, SimulationResult, SimulationSummary
from typing import List

router = APIRouter()
_audit_logger = logging.getLogger("secureforge.audit")


@router.post("/", response_model=SimulationResult)
async def launch_simulation(request: Request, sim_req: SimulationRequest):
    """Launch a new Breach & Attack Simulation."""
    role = getattr(request.state, "role", "Operator")

    if sim_req.detailed_enumeration and role != "Administrator":
        raise HTTPException(
            status_code=403,
            detail="Administrator privileges required to launch red team modules.",
        )

    # #77 fix: structured audit trail — every simulation launch is logged with
    # operator identity, source IP, target, and selected modules so that all
    # red-team activity on the platform has a durable paper trail.
    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    _audit_logger.info(
        "SIMULATION_LAUNCH | role=%s | ip=%s | target=%s | modules=%s | detailed_enum=%s | name=%r",
        role,
        client_ip,
        sim_req.target,
        ",".join(sim_req.modules),
        sim_req.detailed_enumeration,
        sim_req.name,
    )

    orchestrator = request.app.state.orchestrator
    try:
        return await orchestrator.launch(sim_req, role=role)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))

@router.get("/", response_model=List[SimulationResult])
async def list_simulations(request: Request):
    """List all historical and running simulations."""
    return await request.app.state.orchestrator.list_all()

@router.get("/summary", response_model=SimulationSummary)
async def get_summary(request: Request):
    """Get high-level statistics for the dashboard."""
    return await request.app.state.orchestrator.summary()


@router.get("/{sim_id}/events")
async def get_simulation_events(sim_id: str):
    """Fetch event timeline specifically recorded for this simulation."""
    from bas_engine.services.replay_service import ReplayService
    service = ReplayService()
    return await service.get_simulation_timeline(sim_id)


@router.post("/{sim_id}/replay", response_model=SimulationResult)
async def replay_simulation(request: Request, sim_id: str):
    """Replay/rerun a previous simulation with its exact configuration (Issue #7)."""
    role = getattr(request.state, "role", "Operator")
    orchestrator = request.app.state.orchestrator

    sim = orchestrator.get(sim_id)
    if not sim:
        sim = await orchestrator.repo.get_simulation(sim_id)
    if not sim:
        raise HTTPException(status_code=404, detail=f"Simulation {sim_id} not found.")

    metadata = dict(sim.metadata or {})
    launch_options = metadata.get("options", {})
    parallel = metadata.get("parallel", True)
    autonomous = metadata.get("autonomous", False)
    detailed_enum = metadata.get("detailed_enumeration", False)

    if detailed_enum and role != "Administrator":
        raise HTTPException(
            status_code=403,
            detail="Administrator privileges required to replay red team simulation."
        )

    replay_name = f"{sim.name} (Replay)"
    replay_req = SimulationRequest(
        name=replay_name,
        target=sim.target,
        modules=list(sim.modules or []),
        parallel=parallel,
        autonomous=autonomous,
        detailed_enumeration=detailed_enum,
        options=launch_options,
        metadata={
            **metadata,
            "replayed_from": sim_id
        }
    )

    client_ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    _audit_logger.info(
        "SIMULATION_REPLAY | original_id=%s | role=%s | ip=%s | target=%s | modules=%s",
        sim_id,
        role,
        client_ip,
        sim.target,
        ",".join(replay_req.modules),
    )

    try:
        return await orchestrator.launch(replay_req, role=role)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
