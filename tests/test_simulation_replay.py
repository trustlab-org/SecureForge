"""
Unit and integration tests for Simulation Replay and Previous Events Review (Issues #5, #6, #7).
"""
import pytest
import uuid
from datetime import datetime
from unittest.mock import MagicMock, AsyncMock
from fastapi import HTTPException

from bas_engine.database.connection import AsyncSessionLocal, engine, Base
from bas_engine.database.models import EventDB, SimulationDB
from bas_engine.services.replay_service import ReplayService
from bas_engine.models.simulation import SimulationRequest, SimulationResult, SimulationStatus
from bas_engine.core.orchestrator import AttackOrchestrator
from bas_engine.core.event_bus import EventBus
from bas_engine.api.routes.simulations import replay_simulation, get_simulation_events


@pytest.mark.asyncio
async def test_replay_service_timeline_dual_key_matching():
    """Verify ReplayService queries both payload['id'] and payload['sim_id'] (Issue #6)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    sim_id = f"test-sim-{uuid.uuid4().hex[:8]}"

    async with AsyncSessionLocal() as session:
        # Event 1: simulation.started has 'id'
        evt1 = EventDB(
            id=str(uuid.uuid4()),
            event_type="simulation.started",
            payload={"id": sim_id, "target": "192.168.1.100"},
            timestamp=datetime.utcnow()
        )
        # Event 2: module.started has 'sim_id'
        evt2 = EventDB(
            id=str(uuid.uuid4()),
            event_type="module.started",
            payload={"sim_id": sim_id, "module": "owasp_web"},
            timestamp=datetime.utcnow()
        )
        # Event 3: vulnerability.found has 'sim_id'
        evt3 = EventDB(
            id=str(uuid.uuid4()),
            event_type="vulnerability.found",
            payload={"sim_id": sim_id, "finding_details": {"title": "SQL Injection"}},
            timestamp=datetime.utcnow()
        )
        # Event 4: Unrelated event for another simulation
        evt4 = EventDB(
            id=str(uuid.uuid4()),
            event_type="module.started",
            payload={"sim_id": "other-sim-999", "module": "nmap_scan"},
            timestamp=datetime.utcnow()
        )
        session.add_all([evt1, evt2, evt3, evt4])
        await session.commit()

    service = ReplayService()
    timeline = await service.get_simulation_timeline(sim_id)

    assert len(timeline) == 3
    event_types = [e["event_type"] for e in timeline]
    assert "simulation.started" in event_types
    assert "module.started" in event_types
    assert "vulnerability.found" in event_types


@pytest.mark.asyncio
async def test_get_simulation_events_endpoint():
    """Verify get_simulation_events endpoint returns timeline for simulation (Issue #6)."""
    sim_id = f"endpoint-test-{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as session:
        evt = EventDB(
            id=str(uuid.uuid4()),
            event_type="module.completed",
            payload={"sim_id": sim_id, "module": "waf_detection"},
            timestamp=datetime.utcnow()
        )
        session.add(evt)
        await session.commit()

    events = await get_simulation_events(sim_id)
    assert len(events) >= 1
    assert any(e["payload"].get("sim_id") == sim_id for e in events)


@pytest.mark.asyncio
async def test_simulation_replay_route_success(monkeypatch):
    """Verify 1-click simulation replay re-runs with exact parameters (Issue #7)."""
    monkeypatch.setenv("LAB_TARGETS", "192.168.56.102")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    original_sim_id = str(uuid.uuid4())
    original_target = "192.168.56.102"
    original_modules = ["owasp_web", "waf_detection"]
    original_options = {"waf_detection": {"aggressive": True}}

    # Seed an original simulation in DB
    async with AsyncSessionLocal() as session:
        sim_db = SimulationDB(
            id=original_sim_id,
            name="Original Production Audit",
            target=original_target,
            modules=original_modules,
            status="completed",
            metadata_json={
                "options": original_options,
                "parallel": True,
                "autonomous": False,
                "detailed_enumeration": False
            },
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        session.add(sim_db)
        await session.commit()

    # Mock request with orchestrator
    event_bus = EventBus()
    orchestrator = AttackOrchestrator(event_bus)

    req = MagicMock()
    req.state.role = "Administrator"
    req.app.state.orchestrator = orchestrator
    req.headers.get.return_value = "127.0.0.1"
    req.client.host = "127.0.0.1"

    # Call replay_simulation handler
    result = await replay_simulation(req, original_sim_id)

    assert result is not None
    assert result.id != original_sim_id
    assert result.target == original_target
    assert result.modules == original_modules
    assert "(Replay)" in result.name
    assert result.metadata.get("replayed_from") == original_sim_id


@pytest.mark.asyncio
async def test_simulation_replay_route_not_found():
    """Verify 404 raised for nonexistent simulation replay (Issue #7)."""
    event_bus = EventBus()
    orchestrator = AttackOrchestrator(event_bus)

    req = MagicMock()
    req.state.role = "Administrator"
    req.app.state.orchestrator = orchestrator
    req.headers.get.return_value = "127.0.0.1"
    req.client.host = "127.0.0.1"

    with pytest.raises(HTTPException) as exc_info:
        await replay_simulation(req, "nonexistent-id-00000")

    assert exc_info.value.status_code == 404
