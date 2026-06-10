import re
import secrets


GENERATED_EXTERNAL_ID_ALPHABET = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
)
DEFAULT_EXTERNAL_ID_LENGTH = 16
MIN_GENERATED_EXTERNAL_ID_LENGTH = 16
MAX_GENERATED_EXTERNAL_ID_LENGTH = 64

GENERATED_EXTERNAL_ID_PATTERN = (
    rf"[A-Za-z0-9]{{{MIN_GENERATED_EXTERNAL_ID_LENGTH},"
    rf"{MAX_GENERATED_EXTERNAL_ID_LENGTH}}}"
)

# Generation remains base62 only. The 32-character base64url branch is read
# compatibility for existing stored IDs, not a generation policy.
ACCEPTED_EXTERNAL_ID_PATTERN = (
    rf"(?:{GENERATED_EXTERNAL_ID_PATTERN}|[A-Za-z0-9_-]{{32}})"
)
ACCEPTED_EXTERNAL_ID_RE = re.compile(rf"^{ACCEPTED_EXTERNAL_ID_PATTERN}$")


def validate_external_id_length(value):
    if type(value) is not int:
        raise RuntimeError("GIST_EXTERNAL_ID_LENGTH must be an integer")
    if not MIN_GENERATED_EXTERNAL_ID_LENGTH <= value <= MAX_GENERATED_EXTERNAL_ID_LENGTH:
        raise RuntimeError(
            "GIST_EXTERNAL_ID_LENGTH must be between "
            f"{MIN_GENERATED_EXTERNAL_ID_LENGTH} and "
            f"{MAX_GENERATED_EXTERNAL_ID_LENGTH}"
        )
    return value


def generate_external_id(length=DEFAULT_EXTERNAL_ID_LENGTH):
    validate_external_id_length(length)
    return "".join(
        secrets.choice(GENERATED_EXTERNAL_ID_ALPHABET) for _ in range(length)
    )


def validate_external_id(value):
    return isinstance(value, str) and bool(ACCEPTED_EXTERNAL_ID_RE.fullmatch(value))
