"""TOTP-based MFA helpers (SESSION_SECURITY_STATUS.md's spec'd-but-not-built
section, ADMIN_DASHBOARD_AUDIT_AND_RECOMMENDATIONS.md §6.2). Kept as one
small module rather than spread across auth.py/routes/auth.py so the crypto
bits (secret encryption, code verification, backup-code generation) have a
single place to review."""

import base64
import hashlib
import io
import secrets as pysecrets
from typing import List

import pyotp
import qrcode
from cryptography.fernet import Fernet

from app.config import SECRET_KEY

MFA_ISSUER = "Nairobi Matatu MMS"
BACKUP_CODE_COUNT = 8


def _fernet_key() -> bytes:
    # SECRET_KEY is an arbitrary-length hex string (app/config.py), not
    # already a valid 32-byte urlsafe-base64 Fernet key — sha256 gives a
    # deterministic, fixed-length key derived from the same secret this
    # deployment already manages, without adding a second secret to configure.
    digest = hashlib.sha256(SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(secret: str) -> str:
    return Fernet(_fernet_key()).encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str:
    return Fernet(_fernet_key()).decrypt(token.encode()).decode()


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def totp_provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=MFA_ISSUER)


def qr_code_data_uri(uri: str) -> str:
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode()}"


def verify_totp_code(secret: str, code: str) -> bool:
    # valid_window=1 tolerates one 30s step of clock drift either side —
    # tight enough to matter for a brute-force window, loose enough that a
    # phone a few seconds off doesn't lock someone out.
    try:
        return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)
    except Exception:
        return False


def generate_backup_codes(count: int = BACKUP_CODE_COUNT) -> List[str]:
    return [f"{pysecrets.token_hex(4)}-{pysecrets.token_hex(4)}" for _ in range(count)]
