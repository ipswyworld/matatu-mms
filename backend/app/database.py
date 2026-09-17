from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool
from app.config import DATABASE_URL, DATABASE_URL_READONLY

IS_SQLITE = DATABASE_URL.startswith("sqlite")

# SQLite has no real connection pool (single file, single writer) — NullPool
# avoids SQLAlchemy holding idle connections open against it. Postgres gets
# a real pool sized for concurrent request handling; pool_pre_ping guards
# against the pool handing out a connection the DB has since dropped
# (idle timeout, restart) — better a cheap extra round-trip than a request
# failing on a stale connection.
if IS_SQLITE:
    engine = create_async_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
        echo=False,
    )
else:
    engine = create_async_engine(
        DATABASE_URL,
        pool_size=20,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=1800,  # recycle connections every 30 min, ahead of typical DB-side idle timeouts
        echo=False,
    )

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# Read-replica session (DATA_LAYER_SCALING_STATUS.md's read-replica plan):
# a second engine pointed at DATABASE_URL_READONLY, used only by read-heavy
# reporting/dashboard queries — the primary writer connection above is
# untouched regardless of whether a replica is configured. Falls back to
# the primary engine when DATABASE_URL_READONLY is unset (self-hosted
# without the postgres-replica service, or Render before that plan
# decision is made), so every existing call site keeps working unchanged;
# routes that want replica offload ask for `get_read_db` explicitly rather
# than this being a silent global switch.
if DATABASE_URL_READONLY and not IS_SQLITE:
    read_engine = create_async_engine(
        DATABASE_URL_READONLY,
        pool_size=10,
        max_overflow=5,
        pool_pre_ping=True,
        pool_recycle=1800,
        echo=False,
    )
    AsyncSessionReadOnly = async_sessionmaker(
        bind=read_engine, class_=AsyncSession, expire_on_commit=False
    )
else:
    read_engine = engine
    AsyncSessionReadOnly = AsyncSessionLocal


async def get_read_db():
    async with AsyncSessionReadOnly() as session:
        try:
            yield session
        finally:
            await session.close()
