import re

import pytest

from gist_api.external_ids import (
    DEFAULT_EXTERNAL_ID_LENGTH,
    MAX_GENERATED_EXTERNAL_ID_LENGTH,
    MIN_GENERATED_EXTERNAL_ID_LENGTH,
    generate_external_id,
    validate_external_id,
    validate_external_id_length,
)


def test_generate_external_id_defaults_to_base62_default_length():
    external_id = generate_external_id()

    assert len(external_id) == DEFAULT_EXTERNAL_ID_LENGTH
    assert re.fullmatch(r"[A-Za-z0-9]+", external_id)


def test_generate_external_id_uses_configured_length():
    external_id = generate_external_id(24)

    assert len(external_id) == 24
    assert re.fullmatch(r"[A-Za-z0-9]+", external_id)


@pytest.mark.parametrize(
    "external_id",
    [
        "A" * MIN_GENERATED_EXTERNAL_ID_LENGTH,
        "B" * 24,
        "C" * MAX_GENERATED_EXTERNAL_ID_LENGTH,
    ],
)
def test_validate_external_id_accepts_supported_formats(external_id):
    assert validate_external_id(external_id)


@pytest.mark.parametrize(
    "external_id",
    [
        "",
        "A" * (MIN_GENERATED_EXTERNAL_ID_LENGTH - 1),
        "B" * (MAX_GENERATED_EXTERNAL_ID_LENGTH + 1),
        "abc/def",
        ("D" * 30) + "_-",
        "!" * MIN_GENERATED_EXTERNAL_ID_LENGTH,
        None,
    ],
)
def test_validate_external_id_rejects_unsupported_formats(external_id):
    assert not validate_external_id(external_id)


@pytest.mark.parametrize("value", [MIN_GENERATED_EXTERNAL_ID_LENGTH, 24, MAX_GENERATED_EXTERNAL_ID_LENGTH])
def test_validate_external_id_length_accepts_supported_range(value):
    assert validate_external_id_length(value) == value


@pytest.mark.parametrize("value", [MIN_GENERATED_EXTERNAL_ID_LENGTH - 1, MAX_GENERATED_EXTERNAL_ID_LENGTH + 1])
def test_validate_external_id_length_rejects_unsupported_range(value):
    with pytest.raises(RuntimeError, match="between 16 and 64"):
        validate_external_id_length(value)


@pytest.mark.parametrize("value", ["24", 24.0, True])
def test_validate_external_id_length_rejects_non_integers(value):
    with pytest.raises(RuntimeError, match="must be an integer"):
        validate_external_id_length(value)
