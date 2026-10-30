from sqlalchemy import select, or_
from bas_engine.database.connection import AsyncSessionLocal
from bas_engine.database.models import EventDB, SimulationDB
from bas_engine.models.simulation import SimulationRequest
import asyncio
from datetime import datetime

class ReplayService:

    # ------------------------------------------------
    # GET SIMULATION TIMELINE
    # ------------------------------------------------

    async def get_simulation_timeline(
        self,
        sim_id: str
    ):
        async with AsyncSessionLocal() as session:
            try:
                result = await session.execute(
                    select(EventDB)
                    .where(
                        or_(
                            EventDB.payload["id"].as_string() == sim_id,
                            EventDB.payload["sim_id"].as_string() == sim_id
                        )
                    )
                    .order_by(EventDB.timestamp.asc())
                )
                events = result.scalars().all()
            except Exception:
                # Resilient fallback across different SQL dialects / test environments
                result = await session.execute(
                    select(EventDB).order_by(EventDB.timestamp.asc())
                )
                all_events = result.scalars().all()
                events = [
                    e for e in all_events
                    if isinstance(e.payload, dict) and (
                        str(e.payload.get("id")) == sim_id or str(e.payload.get("sim_id")) == sim_id
                    )
                ]

            return [
                {
                    "event_type": e.event_type,
                    "payload": e.payload,
                    "timestamp": e.timestamp.isoformat() if hasattr(e.timestamp, "isoformat") else str(e.timestamp)
                }
                for e in events
            ]

    # ------------------------------------------------
    # GET ALL EVENTS
    # ------------------------------------------------

    async def get_recent_events(
        self,
        limit: int = 100
    ):
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(EventDB).order_by(EventDB.timestamp.desc()).limit(limit)
            )
            events = result.scalars().all()
            return [
                {
                    "event_type": e.event_type,
                    "payload": e.payload,
                    "timestamp": e.timestamp.isoformat()
                }
                for e in events
            ]

    # ------------------------------------------------
    # STORED TIMELINE REPLAY MODE ONLY
    # ------------------------------------------------
    # ------------------------------------------------
    # STREAM TIMELINE (SSE COMPRESSED)
    # ------------------------------------------------
    async def stream_timeline(self, sim_id: str, speed_multiplier: float = 10.0):
        timeline = await self.get_simulation_timeline(sim_id)
        if not timeline:
            yield f"data: {{\"error\": \"No events found for {sim_id}\"}}\n\n"
            return
            
        import json
        last_time = None
        for evt in timeline:
            current_time = datetime.fromisoformat(evt["timestamp"])
            if last_time:
                diff = (current_time - last_time).total_seconds()
                sleep_time = max(0, diff / speed_multiplier)
                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)
            last_time = current_time
            yield f"data: {json.dumps(evt)}\n\n"