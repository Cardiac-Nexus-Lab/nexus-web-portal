"""Cardiac Nexus FastAPI backend.
- Database: SQLAlchemy ORM (PostgreSQL persistence for user profiles, patients, assessments)
- Auth: Firebase Authentication (Firebase ID Token verification)
- Passwords: NEVER stored in backend database
- API Security: HttpOnly Cookies + Bearer Firebase ID Token
"""
import json
import os
import secrets
import time
from datetime import datetime, timezone
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
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_login = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class DBPatient(Base):
    __tablename__ = "patients"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    gender = Column(String, nullable=False)
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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas
class FirebaseSyncRequest(BaseModel):
    idToken: str

class GoogleAuthRequest(BaseModel):
    credential: str

class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    institution: Optional[str] = None

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
            "provider": decoded.get("firebase", {}).get("sign_in_provider", "firebase")
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
            id=f"usr_{int(time.time())}",
            firebase_uid=firebase_data["uid"],
            name=firebase_data["name"],
            email=firebase_data["email"],
            auth_provider=firebase_data["provider"],
            role="Not Set",
            institution="Not Set"
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "authentication": "Firebase Authentication Verified",
        "database": "PostgreSQL Persistent User Profiles & Clinical Data",
        "version": "2.0.0"
    }

@app.post("/api/auth/sync")
async def sync_user(req: FirebaseSyncRequest, response: Response, db: Session = Depends(get_db)):
    """Receives Firebase ID token, verifies token, syncs user profile to PostgreSQL DB."""
    firebase_data = verify_firebase_id_token(req.idToken)
    
    user = db.query(DBUser).filter(
        (DBUser.firebase_uid == firebase_data["uid"]) | (DBUser.email == firebase_data["email"])
    ).first()

    if not user:
        user = DBUser(
            id=f"usr_{int(time.time())}",
            firebase_uid=firebase_data["uid"],
            name=firebase_data["name"],
            email=firebase_data["email"],
            auth_provider=firebase_data["provider"],
            role="Not Set",
            institution="Not Set"
        )
        db.add(user)
    else:
        user.firebase_uid = firebase_data["uid"]
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
            "auth_provider": user.auth_provider
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
    blood_pressure: int = Form(...),
    cholesterol: int = Form(...),
    chest_pain: str = Form(...),
    max_heart_rate: int = Form(...),
    exercise_angina: str = Form(...),
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
        ecg = cardiac_ai.analyze_ecg(ecg_file.filename or "ecg.csv", ecg_bytes)
        mri = cardiac_ai.analyze_mri(mri_uploads, height_cm, weight_kg)
        clinical = cardiac_ai.assess_clinical(age, gender, blood_pressure, cholesterol, max_heart_rate,
                                              chest_pain, exercise_angina)
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
