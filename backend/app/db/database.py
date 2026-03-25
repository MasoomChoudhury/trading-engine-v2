from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool
from app.config import get_settings
from contextlib import asynccontextmanager

settings = get_settings()

# Time-series database (TimescaleDB)
ts_engine = create_async_engine(
    settings.database_url,
    echo=False,
    poolclass=NullPool,
)

# Logs database (PostgreSQL)
logs_engine = create_async_engine(
    settings.logs_database_url,
    echo=False,
    poolclass=NullPool,
)

TS_Session = async_sessionmaker(bind=ts_engine, class_=AsyncSession, expire_on_commit=False)
Logs_Session = async_sessionmaker(bind=logs_engine, class_=AsyncSession, expire_on_commit=False)


@asynccontextmanager
async def get_ts_session():
    async with TS_Session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def get_logs_session():
    async with Logs_Session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
