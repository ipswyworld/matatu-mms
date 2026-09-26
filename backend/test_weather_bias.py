"""
Unit tests for pick_nearest_stage (Phase 8, #14 of the journey-planning
plan — weather-aware terminal choice). Pure function, no DB/network, so
these run with plain pytest, not the async client fixtures conftest.py
sets up for the route-level tests.

Run with: python -m pytest -v  (from the backend/ directory)
"""
from dataclasses import dataclass

from app.routes.search import pick_nearest_stage


@dataclass
class FakeStage:
    id: str
    lat: float
    lng: float
    stage_type: str


# A passenger at the origin (0, 0). A plain STAGE sits very close by; a
# TERMINUS sits a bit farther but still within RAIN_TERMINUS_PREFERENCE_RATIO
# (1.5x) of the stage's distance — the borderline case the plan's own verify
# step calls for.
NEAR_STAGE = FakeStage(id="stage-near", lat=0.0009, lng=0.0, stage_type="STAGE")  # ~100m
NEAR_TERMINUS = FakeStage(id="terminus-near", lat=0.0013, lng=0.0, stage_type="TERMINUS")  # ~145m, within 1.5x
FAR_TERMINUS = FakeStage(id="terminus-far", lat=0.01, lng=0.0, stage_type="TERMINUS")  # ~1.1km, well beyond 1.5x


def test_dry_weather_always_picks_strictly_nearest():
    stages = [NEAR_STAGE, NEAR_TERMINUS, FAR_TERMINUS]
    result = pick_nearest_stage(stages, 0.0, 0.0, is_raining=False)
    assert result.id == "stage-near"


def test_rain_prefers_nearby_terminus_over_closer_bare_stage():
    stages = [NEAR_STAGE, NEAR_TERMINUS]
    result = pick_nearest_stage(stages, 0.0, 0.0, is_raining=True)
    assert result.id == "terminus-near"


def test_rain_does_not_prefer_a_much_farther_terminus():
    stages = [NEAR_STAGE, FAR_TERMINUS]
    result = pick_nearest_stage(stages, 0.0, 0.0, is_raining=True)
    assert result.id == "stage-near"


def test_rain_with_no_terminus_candidates_falls_back_to_nearest():
    stages = [NEAR_STAGE]
    result = pick_nearest_stage(stages, 0.0, 0.0, is_raining=True)
    assert result.id == "stage-near"


def test_rain_when_nearest_is_already_a_terminus_returns_it_directly():
    stages = [NEAR_TERMINUS, FAR_TERMINUS]
    result = pick_nearest_stage(stages, 0.0, 0.0, is_raining=True)
    assert result.id == "terminus-near"
