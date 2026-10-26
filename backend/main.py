"""Cardiac Nexus FastAPI backend.
- Database: SQLAlchemy ORM (PostgreSQL persistence for user profiles, patients, assessments)
- Auth: Firebase Authentication (Firebase ID Token verification)
- Passwords: NEVER stored in backend database
- API Security: HttpOnly Cookies + Bearer Firebase ID Token
"""
import hashlib
import json
import os
import secrets
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import google.auth.transport.requests
from google.oauth2 import id_token as google_id_token
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Depends, Header, Response, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, DateTime, Text
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from starlette.concurrency import run_in_threadpool
from dotenv import load_dotenv

import email_service

# Load environment variables from .env file
load_dotenv()

# Database setup (PostgreSQL required)
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL environment variable is required"
    )

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# SQLAlchemy Database Models (No password_hash stored)
class DBUser(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    firebase_uid = Column(String, unique=True, index=True, nullable=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    google_id = Column(String, nullable=True, index=True)
    auth_provider = Column(String, default="firebase")
    avatar = Column(String, nullable=True)
    photo_url = Column(String, nullable=True)
    role = Column(String, default="Not Set")
    institution = Column(String, default="Not Set")
    is_verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_login = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DBEmailVerification(Base):
    __tablename__ = "email_verifications"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, index=True, nullable=False)
    token_hash = Column(String, index=True, nullable=False)
    otp_hash = Column(String, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_used = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


def hash_otp(email: str, otp: str) -> str:
    """Computes SHA-256 hash of the salted OTP (email + OTP)."""
    return hashlib.sha256(f"{email.lower().strip()}:{otp.strip()}".encode("utf-8")).hexdigest()


def hash_token(token: str) -> str:
    """Computes SHA-256 hash of the verification token."""
    return hashlib.sha256(token.strip().encode("utf-8")).hexdigest()


class DBPatient(Base):
    __tablename__ = "patients"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    age = Column(Integer, nullable=False)
    gender = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    blood_pressure_sys = Column(Integer, nullable=True)
    blood_pressure_dia = Column(Integer, nullable=True)
    cholesterol = Column(Integer, nullable=True)
    medical_history = Column(Text, nullable=True)
    risk_category = Column(String, default="Unassessed")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class DBWellnessScreening(Base):
    __tablename__ = "wellness_screenings"

    id = Column(String, primary_key=True, index=True)
    patient_id = Column(String, nullable=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    heart_rate_bpm = Column(Float, nullable=False)
    hrv_rmssd_ms = Column(Float, nullable=True)
    stress_index = Column(Integer, nullable=True)
    stress_level = Column(String, nullable=True)
    confidence = Column(Float, default=0.95)
    guidance_notes = Column(Text, nullable=True)
    fatigue_level = Column(String, nullable=True)
    sleepiness_level = Column(String, nullable=True)
    facial_expression = Column(String, nullable=True)
    signal_quality = Column(String, nullable=True)
    details_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DBAssessment(Base):
    __tablename__ = "assessments"

    id = Column(String, primary_key=True, index=True)
    patient_id = Column(String, nullable=True)
    risk_score = Column(Integer, nullable=False)
    risk_category = Column(String, nullable=False)
    confidence = Column(Float, nullable=False)
    auroc = Column(Float, default=0.89)
    f1_score = Column(Float, default=0.86)
    avg_precision = Column(Float, default=0.84)
    ecg_uploaded = Column(Boolean, default=False)
    mri_uploaded = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class DBAnalysis(Base):
    """One run of the real models. Replaces DBAssessment, whose AUROC, F1 and
    confidence columns held fixed placeholder values rather than model output;
    that table is left in place so existing databases keep working."""
    __tablename__ = "analyses"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    patient_name = Column(String, nullable=False)
    patient_age = Column(Integer, nullable=False)
    patient_gender = Column(String, nullable=False)
    attention = Column(String, nullable=False)
    result_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

# Create tables automatically
Base.metadata.create_all(bind=engine)

# Database Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# FastAPI App
app = FastAPI(title="Cardiac Nexus API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "https://cardiac-nexus.vercel.app",
        "https://cardiac-nexus-lab.vercel.app"
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas
class CheckEmailRequest(BaseModel):
    email: str

class SendVerificationRequest(BaseModel):
    email: str
    name: Optional[str] = None
    uid: Optional[str] = None

class VerifyOtpRequest(BaseModel):
    email: str
    otp: str

class FirebaseSyncRequest(BaseModel):
    idToken: str

class GoogleAuthRequest(BaseModel):
    credential: str

class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    institution: Optional[str] = None

class PatientCreateRequest(BaseModel):
    name: str
    age: int
    gender: str
    phone: Optional[str] = None
    email: Optional[str] = None
    blood_pressure_sys: Optional[int] = None
    blood_pressure_dia: Optional[int] = None
    cholesterol: Optional[int] = None
    medical_history: Optional[str] = None
    risk_category: Optional[str] = "Unassessed"
    notes: Optional[str] = None

class PatientUpdateRequest(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    blood_pressure_sys: Optional[int] = None
    blood_pressure_dia: Optional[int] = None
    cholesterol: Optional[int] = None
    medical_history: Optional[str] = None
    risk_category: Optional[str] = None
    notes: Optional[str] = None

class WellnessScreeningCreateRequest(BaseModel):
    patient_id: Optional[str] = None
    heart_rate_bpm: float
    hrv_rmssd_ms: Optional[float] = None
    stress_index: Optional[int] = None
    stress_level: Optional[str] = None
    confidence: Optional[float] = 0.95
    guidance_notes: Optional[str] = None
    fatigue_level: Optional[str] = None
    sleepiness_level: Optional[str] = None
    facial_expression: Optional[str] = None
    signal_quality: Optional[str] = None
    details_json: Optional[str] = None

FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")
_google_request = google.auth.transport.requests.Request()

def verify_firebase_id_token(token: str) -> dict:
    """Verifies a Firebase ID token's signature, audience, issuer and expiry.

    The previous version decoded the token with signature checking switched off,
    so a token anyone could write by hand was accepted as any user. Google's
    public keys now check it was really issued by Firebase for this project.
    """
    if not FIREBASE_PROJECT_ID:
        raise HTTPException(status_code=500, detail="FIREBASE_PROJECT_ID is not configured on the server")
    try:
        decoded = google_id_token.verify_firebase_token(
            token, _google_request, audience=FIREBASE_PROJECT_ID, clock_skew_in_seconds=10)
        if decoded.get("iss") != f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}":
            raise ValueError("token was not issued by this Firebase project")
        uid = decoded.get("user_id") or decoded.get("sub") or decoded.get("uid")
        email = decoded.get("email")
        
        if not uid or not email:
            raise HTTPException(status_code=401, detail="Invalid Firebase ID Token structure")
            
        return {
            "uid": uid,
            "email": email.lower().strip(),
            "name": decoded.get("name") or email.split("@")[0].capitalize(),
            "provider": decoded.get("firebase", {}).get("sign_in_provider", "firebase"),
            "email_verified": bool(decoded.get("email_verified", False))
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Failed to verify Firebase ID token: {str(e)}")

def set_auth_cookie(response: Response, token: str):
    response.set_cookie(
        key="cardiac_nexus_token",
        value=token,
        httponly=True,
        max_age=7 * 24 * 3600,
        samesite="lax",
        secure=False
    )

def get_current_user_from_token(
    request: Request,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> DBUser:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
    elif "cardiac_nexus_token" in request.cookies:
        token = request.cookies["cardiac_nexus_token"]

    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    firebase_data = verify_firebase_id_token(token)
    
    user = db.query(DBUser).filter(
        (DBUser.firebase_uid == firebase_data["uid"]) | (DBUser.email == firebase_data["email"])
    ).first()

    if not user:
        user = DBUser(
            id=f"usr_{int(time.time())}_{secrets.token_hex(4)}",
            firebase_uid=firebase_data["uid"],
            name=firebase_data["name"],
            email=firebase_data["email"],
            auth_provider=firebase_data["provider"],
            is_verified=firebase_data.get("email_verified", False) or firebase_data.get("provider") in ("google.com", "google"),
            role="Not Set",
            institution="Not Set"
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # Strictly enforce email verification for workspace access
    is_google = user.auth_provider in ("google.com", "google") or firebase_data.get("provider") in ("google.com", "google")
    is_email_verified = is_google or user.is_verified or firebase_data.get("email_verified", False)
    if not is_email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email address not verified. Please verify your email before accessing Cardiac Nexus workspace."
        )

    return user

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "authentication": "Firebase Authentication Verified",
        "database": "PostgreSQL Persistent User Profiles & Clinical Data",
        "version": "2.0.0"
    }

@app.get("/api/auth/smtp-status")
def get_smtp_status():
    """Checks whether backend SMTP is configured and operational."""
    configured = email_service.is_smtp_configured()
    cfg = email_service.get_smtp_config()
    safe_config = {
        "configured": configured,
        "host": cfg["host"] or "Not configured",
        "port": cfg["port"],
        "user": cfg["user"][:3] + "***@" + cfg["user"].split("@")[-1] if "@" in cfg["user"] else (cfg["user"][:3] + "***" if cfg["user"] else "None"),
        "from_email": cfg["from_email"] or "None",
        "use_tls": cfg["use_tls"],
        "use_ssl": cfg["use_ssl"],
    }
    if configured:
        ok, msg = email_service.test_smtp_connection()
        safe_config["connection_test"] = {"success": ok, "message": msg}
    else:
        safe_config["connection_test"] = {"success": False, "message": "SMTP is not configured in backend/.env"}
    return safe_config

@app.post("/api/auth/check-email")
def check_email(req: CheckEmailRequest, db: Session = Depends(get_db)):
    """Checks whether an email address is already registered in the system."""
    clean_email = req.email.lower().strip()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=400, detail="Invalid email address format")
    
    user = db.query(DBUser).filter(DBUser.email == clean_email).first()
    if user:
        return {
            "exists": True,
            "is_verified": user.is_verified,
            "auth_provider": user.auth_provider,
            "message": "This email address is already registered."
        }
    return {
        "exists": False,
        "is_verified": False,
        "auth_provider": None,
        "message": "Email is available for registration."
    }

@app.get("/api/auth/check-email-status")
def check_email_status(email: str, db: Session = Depends(get_db)):
    """Returns verification status for a specific email."""
    clean_email = email.lower().strip()
    user = db.query(DBUser).filter(DBUser.email == clean_email).first()
    if user:
        return {"email": clean_email, "exists": True, "is_verified": bool(user.is_verified)}
    return {"email": clean_email, "exists": False, "is_verified": False}

@app.post("/api/auth/send-verification")
def send_verification(req: SendVerificationRequest, db: Session = Depends(get_db)):
    """
    Generates a secure 6-digit OTP and verification token (SHA-256 hashed).
    If SMTP is configured, sends a verification email.
    If already registered and verified, prevents duplicate registration.
    """
    clean_email = req.email.lower().strip()
    if not clean_email or "@" not in clean_email:
        raise HTTPException(status_code=400, detail="A valid email address is required.")

    # Prevent duplicate registration if account exists and is already verified
    existing_user = db.query(DBUser).filter(DBUser.email == clean_email).first()
    if existing_user and existing_user.is_verified:
        raise HTTPException(
            status_code=400,
            detail="An account with this email address is already registered and verified. Please sign in or use 'Forgot password'."
        )

    # Save registration details to DBUser if not present (Requirement 1)
    if not existing_user:
        new_user = DBUser(
            id=f"usr_{int(time.time())}_{secrets.token_hex(4)}",
            firebase_uid=req.uid,
            name=req.name or clean_email.split("@")[0].capitalize(),
            email=clean_email,
            auth_provider="password",
            is_verified=False,
            role="Cardiology Researcher",
            institution="Nexus Heart Institute"
        )
        db.add(new_user)
        db.commit()
    elif req.uid and not existing_user.firebase_uid:
        existing_user.firebase_uid = req.uid
        if req.name and (existing_user.name == "Not Set" or not existing_user.name):
            existing_user.name = req.name
        db.commit()

    # Cooldown check: prevent email spamming (allow 1 email per 45 seconds)
    recent_req = db.query(DBEmailVerification).filter(
        DBEmailVerification.email == clean_email,
        DBEmailVerification.created_at >= datetime.now(timezone.utc) - timedelta(seconds=45)
    ).first()
    if recent_req:
        raise HTTPException(
            status_code=429,
            detail="A verification email was recently sent. Please wait 45 seconds before requesting another code."
        )

    # Generate 6-digit cryptographic OTP and 32-byte secure token
    raw_otp = f"{secrets.randbelow(900000) + 100000}"
    raw_token = secrets.token_urlsafe(32)

    # Store SHA-256 hashes (never plaintext)
    otp_hash = hash_otp(clean_email, raw_otp)
    token_hash = hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)

    verification_record = DBEmailVerification(
        id=f"ver_{int(time.time())}_{secrets.token_hex(4)}",
        email=clean_email,
        token_hash=token_hash,
        otp_hash=otp_hash,
        expires_at=expires_at,
        is_used=False,
        attempts=0,
        created_at=datetime.now(timezone.utc)
    )
    db.add(verification_record)
    db.commit()

    # Attempt SMTP delivery if configured
    if email_service.is_smtp_configured():
        sent_ok, msg = email_service.send_verification_email(
            to_email=clean_email,
            name=req.name or "Healthcare Researcher",
            otp_code=raw_otp,
            token=raw_token
        )
        if not sent_ok:
            # Strictly: Do not claim that an email was sent unless the email sending process succeeds.
            raise HTTPException(
                status_code=500,
                detail=f"Email delivery failed via SMTP: {msg}"
            )
        return {
            "success": True,
            "method": "smtp",
            "message": f"Verification email with 6-digit code sent to {clean_email}."
        }
    else:
        # SMTP not configured in backend: report so frontend can use Firebase verification
        return {
            "success": False,
            "method": "firebase_fallback",
            "message": "Backend SMTP is not configured. Falling back to Firebase email verification."
        }

@app.post("/api/auth/verify-otp")
def verify_otp(req: VerifyOtpRequest, db: Session = Depends(get_db)):
    """Verifies a 6-digit OTP code against the SHA-256 hash in email_verifications."""
    clean_email = req.email.lower().strip()
    clean_otp = req.otp.strip()

    if not clean_email or not clean_otp:
        raise HTTPException(status_code=400, detail="Email and 6-digit OTP code are required.")

    computed_hash = hash_otp(clean_email, clean_otp)
    now = datetime.now(timezone.utc)

    # Find the most recent active verification record
    record = db.query(DBEmailVerification).filter(
        DBEmailVerification.email == clean_email,
        DBEmailVerification.is_used == False
    ).order_by(DBEmailVerification.created_at.desc()).first()

    if not record:
        raise HTTPException(status_code=400, detail="No active verification code found for this email. Please request a new code.")

    if record.expires_at.tzinfo is None:
        rec_expiry = record.expires_at.replace(tzinfo=timezone.utc)
    else:
        rec_expiry = record.expires_at

    if now > rec_expiry:
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new code.")

    if record.attempts >= 5:
        record.is_used = True
        db.commit()
        raise HTTPException(status_code=400, detail="Too many invalid attempts. For security, please request a new verification code.")

    if record.otp_hash != computed_hash:
        record.attempts += 1
        db.commit()
        remaining = max(0, 5 - record.attempts)
        raise HTTPException(status_code=400, detail=f"Incorrect 6-digit verification code. ({remaining} attempts remaining)")

    # OTP is correct! Mark record as used
    record.is_used = True

    # Update DBUser if exists
    user = db.query(DBUser).filter(DBUser.email == clean_email).first()
    if user:
        user.is_verified = True
    else:
        # Create user record in DB with is_verified = True
        user = DBUser(
            id=f"usr_{int(time.time())}_{secrets.token_hex(4)}",
            name=clean_email.split("@")[0].capitalize(),
            email=clean_email,
            auth_provider="password",
            is_verified=True,
            role="Not Set",
            institution="Not Set"
        )
        db.add(user)

    db.commit()
    return {
        "success": True,
        "message": f"Email {clean_email} successfully verified! Your account is now active.",
        "email": clean_email,
        "is_verified": True
    }

@app.get("/api/auth/verify-link")
def verify_link(token: str, email: str, db: Session = Depends(get_db)):
    """Verifies a direct link verification token and redirects or returns confirmation."""
    clean_email = email.lower().strip()
    computed_hash = hash_token(token)
    now = datetime.now(timezone.utc)

    record = db.query(DBEmailVerification).filter(
        DBEmailVerification.email == clean_email,
        DBEmailVerification.token_hash == computed_hash,
        DBEmailVerification.is_used == False
    ).first()

    if not record:
        return Response(
            content="<html><body style='font-family:sans-serif;text-align:center;padding:50px;'>"
                    "<h2 style='color:#b91c1c;'>Invalid or Expired Verification Link</h2>"
                    "<p>This email verification link is invalid or has already been used.</p>"
                    "<a href='/' style='color:#0284c7;'>Return to Cardiac Nexus</a>"
                    "</body></html>",
            media_type="text/html",
            status_code=400
        )

    if record.expires_at.tzinfo is None:
        rec_expiry = record.expires_at.replace(tzinfo=timezone.utc)
    else:
        rec_expiry = record.expires_at

    if now > rec_expiry:
        return Response(
            content="<html><body style='font-family:sans-serif;text-align:center;padding:50px;'>"
                    "<h2 style='color:#b91c1c;'>Verification Link Expired</h2>"
                    "<p>This link expired after 15 minutes. Please request a new verification code.</p>"
                    "<a href='/' style='color:#0284c7;'>Return to Cardiac Nexus</a>"
                    "</body></html>",
            media_type="text/html",
            status_code=400
        )

    record.is_used = True
    user = db.query(DBUser).filter(DBUser.email == clean_email).first()
    if user:
        user.is_verified = True
    else:
        user = DBUser(
            id=f"usr_{int(time.time())}_{secrets.token_hex(4)}",
            name=clean_email.split("@")[0].capitalize(),
            email=clean_email,
            auth_provider="password",
            is_verified=True,
            role="Not Set",
            institution="Not Set"
        )
        db.add(user)
    db.commit()

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    return Response(
        content=f"<html><head><meta http-equiv='refresh' content='2;url={frontend_url}/?verified=true&email={clean_email}'></head>"
                f"<body style='font-family:sans-serif;text-align:center;padding:50px;'>"
                f"<h2 style='color:#15803d;'>Email Verified Successfully!</h2>"
                f"<p>Your email <strong>{clean_email}</strong> has been verified. Redirecting to Cardiac Nexus...</p>"
                f"<p><a href='{frontend_url}/?verified=true&email={clean_email}' style='color:#0284c7;'>Click here if not redirected automatically</a></p>"
                f"</body></html>",
        media_type="text/html"
    )

@app.post("/api/auth/resend-verification")
def resend_verification(req: SendVerificationRequest, db: Session = Depends(get_db)):
    """Resends a verification email or OTP for an unverified account."""
    return send_verification(req, db)

@app.post("/api/auth/sync")
async def sync_user(req: FirebaseSyncRequest, response: Response, db: Session = Depends(get_db)):
    """Receives Firebase ID token, verifies token, syncs user profile to PostgreSQL DB."""
    firebase_data = verify_firebase_id_token(req.idToken)
    clean_email = firebase_data["email"].lower().strip()
    
    user = db.query(DBUser).filter(
        (DBUser.firebase_uid == firebase_data["uid"]) | (DBUser.email == clean_email)
    ).first()

    # Determine verification status
    is_google = firebase_data.get("provider") in ("google.com", "google")
    token_verified = firebase_data.get("email_verified", False)
    db_verified = user.is_verified if user else False
    is_verified = is_google or token_verified or db_verified

    # Unverified password accounts must not receive active sync session
    if not is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Email address is not verified. Please verify your email before continuing.",
                "code": "EMAIL_NOT_VERIFIED",
                "email": clean_email,
                "is_verified": False
            }
        )

    if not user:
        user = DBUser(
            id=f"usr_{int(time.time())}_{secrets.token_hex(4)}",
            firebase_uid=firebase_data["uid"],
            name=firebase_data["name"],
            email=clean_email,
            auth_provider=firebase_data["provider"],
            is_verified=True,
            role="Not Set",
            institution="Not Set"
        )
        db.add(user)
    else:
        user.firebase_uid = firebase_data["uid"]
        user.is_verified = True
        user.last_login = datetime.now(timezone.utc)

    db.commit()
    db.refresh(user)
    set_auth_cookie(response, req.idToken)

    return {
        "message": "User synchronized with backend database successfully",
        "access_token": req.idToken,
        "user": {
            "id": user.id,
            "firebase_uid": user.firebase_uid,
            "name": user.name,
            "email": user.email,
            "role": user.role or "Not Set",
            "institution": user.institution or "Not Set",
            "auth_provider": user.auth_provider,
            "is_verified": user.is_verified
        }
    }

@app.post("/api/auth/google")
async def google_auth(req: GoogleAuthRequest, response: Response, db: Session = Depends(get_db)):
    """Compatibility endpoint for Google auth forwarding to Firebase sync."""
    return await sync_user(FirebaseSyncRequest(idToken=req.credential), response, db)

@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("cardiac_nexus_token")
    return {"message": "Logged out successfully"}

@app.get("/api/auth/me")
def get_me(user: DBUser = Depends(get_current_user_from_token)):
    return {
        "id": user.id,
        "firebase_uid": user.firebase_uid,
        "name": user.name,
        "email": user.email,
        "role": user.role or "Not Set",
        "institution": user.institution or "Not Set",
        "auth_provider": user.auth_provider,
        "created_at": user.created_at.isoformat() if user.created_at else None
    }

@app.put("/api/auth/profile")
def update_profile(
    req: ProfileUpdateRequest,
    user: DBUser = Depends(get_current_user_from_token),
    db: Session = Depends(get_db)
):
    """Updates user full name, role, and institution in PostgreSQL."""
    if req.name is not None and req.name.strip():
        user.name = req.name.strip()
    if req.role is not None:
        user.role = req.role.strip() if req.role.strip() else "Not Set"
    if req.institution is not None:
        user.institution = req.institution.strip() if req.institution.strip() else "Not Set"

    db.commit()
    db.refresh(user)

    return {
        "id": user.id,
        "firebase_uid": user.firebase_uid,
        "name": user.name,
        "email": user.email,
        "role": user.role or "Not Set",
        "institution": user.institution or "Not Set",
        "auth_provider": user.auth_provider
    }

def get_optional_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
) -> Optional[DBUser]:
    """The signed-in user if there is one; analysis also works signed out."""
    if not (authorization and authorization.startswith("Bearer ")) and "cardiac_nexus_token" not in request.cookies:
        return None
    try:
        return get_current_user_from_token(request, authorization, db)
    except HTTPException:
        return None


def new_analysis_id() -> str:
    # Second resolution plus a random suffix. The earlier minute-resolution ID
    # collided when two analyses ran within the same minute and crashed the save.
    return f"CNX-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{secrets.token_hex(2).upper()}"


@app.post("/api/analyze")
async def analyze(
    request: Request,
    name: str = Form(...),
    age: int = Form(...),
    gender: str = Form(...),
    blood_pressure: Optional[int] = Form(None),
    cholesterol: Optional[int] = Form(None),
    chest_pain: Optional[str] = Form(None),
    max_heart_rate: Optional[int] = Form(None),
    exercise_angina: Optional[str] = Form(None),
    height_cm: Optional[float] = Form(None),
    weight_kg: Optional[float] = Form(None),
    ecg_file: UploadFile = File(...),
    mri_file: List[UploadFile] = File(...),
    user: Optional[DBUser] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Runs the trained ECG and MRI models and checks clinical values against guideline ranges."""
    import cardiac_ai

    if not name or not name.strip() or not gender or ecg_file is None or not mri_file:
        raise HTTPException(
            status_code=400,
            detail="Missing required inputs: Patient Name, Age, Gender, ECG file, and MRI file are required for pipeline execution."
        )

    ecg_bytes = await ecg_file.read()
    mri_uploads = [(f.filename or "mri", await f.read()) for f in mri_file]

    def run():
        # The quick checks on typed values first, so a typo fails before the models run.
        clinical = cardiac_ai.assess_clinical(age, gender, blood_pressure, cholesterol, max_heart_rate,
                                              chest_pain, exercise_angina)
        cardiac_ai.check_body_size(height_cm, weight_kg)
        ecg = cardiac_ai.analyze_ecg(ecg_file.filename or "ecg.csv", ecg_bytes)
        mri = cardiac_ai.analyze_mri(mri_uploads, height_cm, weight_kg)
        return ecg, mri, clinical, cardiac_ai.summarize(ecg, mri, clinical)

    try:
        ecg, mri, clinical, summary = await run_in_threadpool(run)
    except cardiac_ai.InputError as error:
        raise HTTPException(status_code=422, detail=str(error))

    analysis_id = new_analysis_id()
    created = datetime.now(timezone.utc)
    result = {
        "id": analysis_id,
        "created_at": created.isoformat(),
        "patient_name": name.strip(),
        "patient_age": age,
        "patient_gender": gender,
        "inputs": {"blood_pressure": blood_pressure, "cholesterol": cholesterol, "max_heart_rate": max_heart_rate,
                   "chest_pain": chest_pain, "exercise_angina": exercise_angina,
                   "height_cm": height_cm, "weight_kg": weight_kg,
                   "ecg_file": ecg_file.filename, "mri_files": [n for n, _ in mri_uploads]},
        "risk_category": summary["attention"],
        "summary": summary,
        "ecg": ecg,
        "mri": mri,
        "clinical": clinical,
        "ecg_uploaded": True,
        "mri_uploaded": True,
        "disclaimer": cardiac_ai.DISCLAIMER,
    }

    db.add(DBAnalysis(
        id=analysis_id,
        user_id=user.id if user else None,
        patient_name=name.strip(),
        patient_age=age,
        patient_gender=gender,
        attention=summary["attention"],
        result_json=json.dumps(result),
        created_at=created,
    ))

    # Link with patient record if available
    matched_patient = db.query(DBPatient).filter(DBPatient.name.ilike(name.strip())).first()
    if matched_patient:
        matched_patient.risk_category = f"{summary['attention'].capitalize()} risk"
        matched_patient.blood_pressure_sys = blood_pressure
        matched_patient.cholesterol = cholesterol
        matched_patient.updated_at = created

    db.commit()
    return result


@app.post("/api/report.pdf")
def report_pdf(result: dict):
    """Renders an analysis result, as returned by /api/analyze, into an A4 PDF."""
    import report_pdf as report

    if not isinstance(result.get("summary"), dict) or "ecg" not in result or "mri" not in result:
        raise HTTPException(status_code=422, detail="Not an analysis result")
    try:
        pdf = report.build_report_pdf(result)
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=f"Could not build the report: {error}")
    filename = f"cardiac-nexus-report-{str(result.get('id', 'analysis'))}.pdf"
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/analyses")
def list_analyses(user: DBUser = Depends(get_current_user_from_token), db: Session = Depends(get_db)):
    """The signed-in user's analyses, newest first."""
    rows = db.query(DBAnalysis).filter(DBAnalysis.user_id == user.id).order_by(DBAnalysis.created_at.desc()).all()
    return [
        {"id": r.id, "created_at": r.created_at.isoformat() if r.created_at else None,
         "patient_name": r.patient_name, "patient_age": r.patient_age, "patient_gender": r.patient_gender,
         "attention": r.attention}
        for r in rows
    ]


@app.get("/api/analyses/{analysis_id}")
def get_analysis(analysis_id: str, user: DBUser = Depends(get_current_user_from_token),
                 db: Session = Depends(get_db)):
    row = db.query(DBAnalysis).filter(DBAnalysis.id == analysis_id, DBAnalysis.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return json.loads(row.result_json)


# ============================================================================
# PATIENTS MANAGEMENT API (PostgreSQL CRUD)
# ============================================================================

def seed_sample_patients(db: Session):
    sample_patients = [
        DBPatient(
            id="CNX-P01",
            name="Eleanor Vance",
            age=62,
            gender="Female",
            phone="+1 (555) 234-5678",
            email="e.vance@example.org",
            blood_pressure_sys=145,
            blood_pressure_dia=92,
            cholesterol=240,
            medical_history="Hypertension, Exertional angina, Dyslipidemia",
            risk_category="High risk",
            notes="Under observation for ischemic ST-T changes. Scheduled for stress CMR."
        ),
        DBPatient(
            id="CNX-P02",
            name="Marcus Sterling",
            age=54,
            gender="Male",
            phone="+1 (555) 345-6789",
            email="m.sterling@example.org",
            blood_pressure_sys=138,
            blood_pressure_dia=86,
            cholesterol=215,
            medical_history="Mild dyslipidemia, Type 2 diabetes",
            risk_category="Moderate risk",
            notes="Periodic checkups for glycemic control and resting ECG."
        ),
        DBPatient(
            id="CNX-P03",
            name="Sofia Rodriguez",
            age=45,
            gender="Female",
            phone="+1 (555) 456-7890",
            email="s.rodriguez@example.org",
            blood_pressure_sys=118,
            blood_pressure_dia=76,
            cholesterol=178,
            medical_history="No known cardiovascular pathology",
            risk_category="Low risk",
            notes="Annual preventive screening. Normal ejection fraction."
        ),
        DBPatient(
            id="CNX-P04",
            name="David Chen",
            age=58,
            gender="Male",
            phone="+1 (555) 567-8901",
            email="d.chen@example.org",
            blood_pressure_sys=152,
            blood_pressure_dia=96,
            cholesterol=258,
            medical_history="Hypertension, Ex-smoker (15 pack-years), Mild LV hypertrophy",
            risk_category="High risk",
            notes="Referred for cine CMR volumetry and biventricular strain assessment."
        ),
        DBPatient(
            id="CNX-P05",
            name="Aisha Patel",
            age=39,
            gender="Female",
            phone="+1 (555) 678-9012",
            email="a.patel@example.org",
            blood_pressure_sys=122,
            blood_pressure_dia=80,
            cholesterol=190,
            medical_history="Family history of premature CAD",
            risk_category="Low risk",
            notes="Baseline wellness check; active aerobic lifestyle."
        )
    ]
    for p in sample_patients:
        db.add(p)
    db.commit()


@app.get("/api/patients")
def list_patients(
    search: Optional[str] = None,
    risk: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """Retrieve all patients from PostgreSQL with optional search and risk-level filtering."""
    query = db.query(DBPatient)
    
    # Auto-seed if table is empty so the frontend immediately showcases live DB records
    if query.count() == 0:
        seed_sample_patients(db)
        query = db.query(DBPatient)

    if search:
        s = f"%{search.strip().lower()}%"
        query = query.filter(
            (DBPatient.name.ilike(s)) |
            (DBPatient.id.ilike(s)) |
            (DBPatient.phone.ilike(s)) |
            (DBPatient.email.ilike(s)) |
            (DBPatient.medical_history.ilike(s))
        )
    
    if risk and risk.lower() != "all":
        query = query.filter(DBPatient.risk_category.ilike(f"%{risk.strip()}%"))

    total = query.count()
    patients = query.order_by(DBPatient.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "patients": [
            {
                "id": p.id,
                "name": p.name,
                "age": p.age,
                "gender": p.gender,
                "phone": p.phone or "Not Provided",
                "email": p.email or "Not Provided",
                "blood_pressure": f"{p.blood_pressure_sys}/{p.blood_pressure_dia}" if p.blood_pressure_sys and p.blood_pressure_dia else (str(p.blood_pressure_sys) if p.blood_pressure_sys else "Not recorded"),
                "blood_pressure_sys": p.blood_pressure_sys,
                "blood_pressure_dia": p.blood_pressure_dia,
                "cholesterol": p.cholesterol,
                "medical_history": p.medical_history or "None documented",
                "risk_category": p.risk_category or "Unassessed",
                "notes": p.notes or "",
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
            for p in patients
        ]
    }


@app.get("/api/patients/{patient_id}")
def get_patient(patient_id: str, db: Session = Depends(get_db)):
    """Retrieve full record for a specific patient, including historical analyses."""
    patient = db.query(DBPatient).filter(DBPatient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient record not found")

    analyses = db.query(DBAnalysis).filter(
        DBAnalysis.patient_name.ilike(patient.name)
    ).order_by(DBAnalysis.created_at.desc()).all()

    screenings = db.query(DBWellnessScreening).filter(
        DBWellnessScreening.patient_id == patient_id
    ).order_by(DBWellnessScreening.created_at.desc()).all()

    return {
        "id": patient.id,
        "name": patient.name,
        "age": patient.age,
        "gender": patient.gender,
        "phone": patient.phone,
        "email": patient.email,
        "blood_pressure_sys": patient.blood_pressure_sys,
        "blood_pressure_dia": patient.blood_pressure_dia,
        "cholesterol": patient.cholesterol,
        "medical_history": patient.medical_history,
        "risk_category": patient.risk_category,
        "notes": patient.notes,
        "created_at": patient.created_at.isoformat() if patient.created_at else None,
        "updated_at": patient.updated_at.isoformat() if patient.updated_at else None,
        "analyses": [
            {
                "id": a.id,
                "attention": a.attention,
                "created_at": a.created_at.isoformat() if a.created_at else None
            }
            for a in analyses
        ],
        "wellness_screenings": [
            {
                "id": s.id,
                "heart_rate_bpm": s.heart_rate_bpm,
                "stress_index": s.stress_index,
                "stress_level": s.stress_level,
                "created_at": s.created_at.isoformat() if s.created_at else None
            }
            for s in screenings
        ]
    }


@app.post("/api/patients", status_code=201)
def create_patient(req: PatientCreateRequest, db: Session = Depends(get_db)):
    """Create a new patient record in PostgreSQL."""
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Patient name is required")
    if req.age <= 0 or req.age > 130:
        raise HTTPException(status_code=400, detail="Age must be between 1 and 130")

    existing_count = db.query(DBPatient).count()
    candidate_id = f"CNX-P{existing_count + 1:02d}"
    if db.query(DBPatient).filter(DBPatient.id == candidate_id).first():
        candidate_id = f"CNX-P{secrets.token_hex(2).upper()}"

    patient = DBPatient(
        id=candidate_id,
        name=req.name.strip(),
        age=req.age,
        gender=req.gender.strip(),
        phone=req.phone.strip() if req.phone else None,
        email=req.email.strip() if req.email else None,
        blood_pressure_sys=req.blood_pressure_sys,
        blood_pressure_dia=req.blood_pressure_dia,
        cholesterol=req.cholesterol,
        medical_history=req.medical_history.strip() if req.medical_history else None,
        risk_category=req.risk_category or "Unassessed",
        notes=req.notes.strip() if req.notes else None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return {"message": "Patient created successfully", "patient": {"id": patient.id, "name": patient.name}}


@app.put("/api/patients/{patient_id}")
def update_patient(patient_id: str, req: PatientUpdateRequest, db: Session = Depends(get_db)):
    """Update an existing patient record in PostgreSQL."""
    patient = db.query(DBPatient).filter(DBPatient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient record not found")

    if req.name is not None and req.name.strip():
        patient.name = req.name.strip()
    if req.age is not None:
        patient.age = req.age
    if req.gender is not None:
        patient.gender = req.gender.strip()
    if req.phone is not None:
        patient.phone = req.phone.strip() if req.phone.strip() else None
    if req.email is not None:
        patient.email = req.email.strip() if req.email.strip() else None
    if req.blood_pressure_sys is not None:
        patient.blood_pressure_sys = req.blood_pressure_sys
    if req.blood_pressure_dia is not None:
        patient.blood_pressure_dia = req.blood_pressure_dia
    if req.cholesterol is not None:
        patient.cholesterol = req.cholesterol
    if req.medical_history is not None:
        patient.medical_history = req.medical_history.strip() if req.medical_history.strip() else None
    if req.risk_category is not None:
        patient.risk_category = req.risk_category
    if req.notes is not None:
        patient.notes = req.notes.strip() if req.notes.strip() else None

    patient.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(patient)
    return {"message": "Patient updated successfully", "patient": {"id": patient.id, "name": patient.name}}


@app.delete("/api/patients/{patient_id}")
def delete_patient(patient_id: str, db: Session = Depends(get_db)):
    """Delete a patient record from PostgreSQL."""
    patient = db.query(DBPatient).filter(DBPatient.id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient record not found")
    
    db.delete(patient)
    db.commit()
    return {"message": f"Patient {patient_id} deleted successfully"}


@app.post("/api/patients/seed")
def seed_patients_endpoint(db: Session = Depends(get_db)):
    """Reset or seed sample patient cohort for demonstration."""
    db.query(DBPatient).delete()
    db.commit()
    seed_sample_patients(db)
    return {"message": "Sample patient cohort seeded successfully", "count": db.query(DBPatient).count()}


# ============================================================================
# WELLNESS SCREENING API
# ============================================================================

@app.post("/api/wellness/screenings", status_code=201)
def log_wellness_screening(
    req: WellnessScreeningCreateRequest,
    user: Optional[DBUser] = Depends(get_optional_user),
    db: Session = Depends(get_db)
):
    """Logs a contactless camera-based photoplethysmography screening with strict validation."""
    if req.heart_rate_bpm is None or req.heart_rate_bpm < 40 or req.heart_rate_bpm > 220:
        raise HTTPException(
            status_code=422,
            detail="Camera analysis validation failed: Estimated heart rate is outside physiological range or invalid."
        )
    if req.confidence is not None and req.confidence < 0.35:
        raise HTTPException(
            status_code=422,
            detail="Camera analysis validation failed: Signal confidence is insufficient for clinical logging."
        )
    quality = (req.signal_quality or "").lower()
    if "insufficient" in quality or "no face" in quality or "failed" in quality:
        raise HTTPException(
            status_code=422,
            detail="Cannot record screening: Camera data was flagged with insufficient signal quality or no face detected."
        )

    screening_id = f"WLN-{datetime.now(timezone.utc):%Y%m%d%H%M%S}-{secrets.token_hex(2).upper()}"
    screening = DBWellnessScreening(
        id=screening_id,
        patient_id=req.patient_id,
        user_id=user.id if user else None,
        heart_rate_bpm=round(req.heart_rate_bpm, 1),
        hrv_rmssd_ms=round(req.hrv_rmssd_ms, 1) if req.hrv_rmssd_ms is not None else None,
        stress_index=req.stress_index,
        stress_level=req.stress_level,
        confidence=req.confidence or 0.95,
        guidance_notes=req.guidance_notes,
        fatigue_level=req.fatigue_level,
        sleepiness_level=req.sleepiness_level,
        facial_expression=req.facial_expression,
        signal_quality=req.signal_quality,
        details_json=req.details_json,
        created_at=datetime.now(timezone.utc),
    )
    db.add(screening)
    db.commit()
    db.refresh(screening)
    return {"message": "Screening logged successfully", "screening_id": screening.id}


@app.get("/api/wellness/screenings")
def list_wellness_screenings(
    patient_id: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Retrieve historical wellness screenings."""
    query = db.query(DBWellnessScreening)
    if patient_id:
        query = query.filter(DBWellnessScreening.patient_id == patient_id)
    
    rows = query.order_by(DBWellnessScreening.created_at.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "patient_id": r.patient_id,
            "heart_rate_bpm": r.heart_rate_bpm,
            "hrv_rmssd_ms": r.hrv_rmssd_ms,
            "stress_index": r.stress_index,
            "stress_level": r.stress_level,
            "confidence": r.confidence,
            "guidance_notes": r.guidance_notes,
            "fatigue_level": r.fatigue_level or "Alert & Attentive",
            "sleepiness_level": r.sleepiness_level or "Awake",
            "facial_expression": r.facial_expression or "Neutral",
            "signal_quality": r.signal_quality or "Good (78%)",
            "details_json": r.details_json,
            "created_at": r.created_at.isoformat() if r.created_at else None
        }
        for r in rows
    ]


@app.post("/api/wellness/report.pdf")
def wellness_report_pdf(req: dict):
    """Renders a Cardiac Wellness biometric screening into an A4 PDF document with validation."""
    hr = req.get("heart_rate_bpm") or req.get("heartRate")
    if hr is None or float(hr) < 40 or float(hr) > 220:
        raise HTTPException(
            status_code=422,
            detail="Cannot generate report: Camera analysis data is missing, invalid, or outside physiological range."
        )

    import report_pdf as report
    try:
        pdf = report.build_wellness_report_pdf(req)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Could not build the wellness report: {error}")
    filename = f"cardiac-wellness-report-{str(req.get('id') or req.get('screening_id') or 'screening')}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ============================================================================
# EXTERNAL MRI BENCHMARKS API
# ============================================================================

@app.get("/api/mri/external-validation")
def get_external_validation_report():
    """MRI segmenter test results, read from the files nexus-ai-engine wrote when it evaluated the served model."""
    import cardiac_ai

    folder = cardiac_ai.ENGINE / "results" / "mri_segmentation_pooled"
    try:
        tests = json.loads((folder / "pooled_test_comparison.json").read_text())["test"]
        kaggle = json.loads((folder / "kaggle" / "kaggle_test_validation.json").read_text())
    except (OSError, KeyError, ValueError):
        raise HTTPException(status_code=404, detail="The pooled MRI model's test results are not in nexus-ai-engine.")

    def r(value):
        return round(float(value), 3)

    names = {"acdc": "ACDC", "mnms": "M&Ms", "mnms2": "M&Ms-2"}
    datasets = []
    for key, name in names.items():
        report = tests[key]["pooled model"]
        entry = {
            "name": f"{name} held-out test patients",
            "patients_evaluated": report["dice"]["LV_ed"]["n"],
            "dice_end_diastole": {s: r(report["dice"][f"{s}_ed"]["estimate"]) for s in ("LV", "RV", "MYO")},
            "lv_ef_mean_absolute_error_points": r(report["derived_measures"]["LV_ejection_fraction_percent"]["mean_absolute_error"]),
        }
        if "dice_by_vendor" in report:
            # Mean Dice over the three structures at both phases; M&Ms codes vendors A-D.
            entry["mean_dice_by_vendor"] = {v: {"dice": r(s["estimate"]), "patients": s["n"]}
                                            for v, s in report["dice_by_vendor"].items() if v != "nan"}
        datasets.append(entry)
    ef = kaggle["frustum"]["lv_ef_percent"]
    datasets.append({
        "name": "Kaggle Data Science Bowl cardiac test set (clinician volumes, no outlines)",
        "patients_evaluated": ef["n"],
        "lv_ef_mean_absolute_error_points": r(ef["mean_absolute_error"]),
        "lv_ef_correlation": r(ef["correlation"]),
    })
    return {
        "benchmark_name": "Pooled MRI segmenter (trained on ACDC, M&Ms and M&Ms-2): held-out test results",
        "datasets": datasets,
        "summary": ("Test patients were held out of training, but ACDC, M&Ms and M&Ms-2 also supplied training "
                    "patients, so only the Kaggle set is fully external."),
    }

