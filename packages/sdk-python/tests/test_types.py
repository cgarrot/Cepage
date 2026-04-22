"""Round-trip tests for the dataclass deserializers."""

from __future__ import annotations

from cepage.types import (
    ScheduledSkillRun,
    SkillRun,
    UserSkill,
    WorkflowSkill,
)


def test_workflow_skill_from_dict_preserves_raw_payload() -> None:
    payload = {
        "id": "foo",
        "title": "Foo",
        "summary": "Summary",
        "version": "1.0.0",
        "kind": "workflow",
        "inputsSchema": {"type": "object"},
        "extraFutureField": 123,
    }
    skill = WorkflowSkill.from_dict(payload)
    assert skill.id == "foo"
    assert skill.kind == "workflow"
    assert skill.inputs_schema == {"type": "object"}
    # Unknown keys are preserved on the ``raw`` field for forward compatibility.
    assert skill.raw["extraFutureField"] == 123


def test_user_skill_round_trip_preserves_source_session() -> None:
    skill = UserSkill.from_dict(
        {
            "id": "us1",
            "slug": "us1",
            "title": "T",
            "summary": "",
            "version": "1",
            "kind": "workflow_template",
            "sourceSessionId": "s1",
            "inputsSchema": {},
            "outputsSchema": {},
            "createdAt": "2026-04-21",
            "updatedAt": "2026-04-21",
        }
    )
    assert skill.source_session_id == "s1"


def test_skill_run_from_dict_parses_basic_fields() -> None:
    run = SkillRun.from_dict(
        {
            "id": "run-1",
            "status": "running",
            "skillId": "foo",
            "inputs": {"a": 1},
            "triggeredBy": "sdk",
        }
    )
    assert run.id == "run-1"
    assert run.status == "running"
    assert run.inputs == {"a": 1}
    assert run.triggered_by == "sdk"
    assert run.is_terminal is False


def test_skill_run_is_terminal_for_finished_statuses() -> None:
    for s in ("succeeded", "failed", "cancelled"):
        run = SkillRun.from_dict(
            {"id": "r", "status": s, "skillId": "foo", "inputs": {}}
        )
        assert run.is_terminal is True


def test_scheduled_skill_run_from_dict() -> None:
    row = ScheduledSkillRun.from_dict(
        {
            "id": "s1",
            "skillId": "foo",
            "cron": "0 9 * * 1",
            "request": {"inputs": {}},
            "status": "active",
            "nextRunAt": "2026-04-28",
        }
    )
    assert row.skill_id == "foo"
    assert row.cron == "0 9 * * 1"
