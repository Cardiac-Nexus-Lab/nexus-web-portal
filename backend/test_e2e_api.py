import urllib.request
import json

BASE = "http://127.0.0.1:8000/api"

def get(path):
    req = urllib.request.Request(f"{BASE}{path}")
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode())

def post(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode())

def put(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=body, headers={"Content-Type": "application/json"}, method="PUT")
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode())

def delete(path):
    req = urllib.request.Request(f"{BASE}{path}", method="DELETE")
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode())

def run_tests():
    print("[1] Testing /health...")
    status, res = get("/health")
    assert status == 200, f"Health check failed: {res}"
    print(f"    Health: OK (status={res.get('status')})")

    print("[2] Testing /patients (GET)...")
    status, res = get("/patients")
    assert status == 200 and "patients" in res, f"List patients failed: {res}"
    patients = res["patients"]
    print(f"    Found {len(patients)} patients in DB (total={res.get('total')}).")

    print("[3] Testing /patients (POST)...")
    new_pat = {
        "name": "E2E Test Patient",
        "age": 49,
        "gender": "Female",
        "phone": "+1 555-0199",
        "email": "e2e@cardiacnexus.test",
        "blood_pressure_sys": 134,
        "blood_pressure_dia": 86,
        "cholesterol": 215,
        "medical_history": "Mild hypertension, testing cohort",
        "risk_category": "Moderate risk",
        "notes": "Automated E2E validation entry"
    }
    status, created = post("/patients", new_pat)
    assert status == 201 and "patient" in created, f"Create patient failed: {created}"
    pat_id = created["patient"]["id"]
    print(f"    Created Patient ID: #{pat_id} ({created['patient']['name']})")

    print(f"[4] Testing /patients/{pat_id} (GET)...")
    status, details = get(f"/patients/{pat_id}")
    assert status == 200 and details.get("id") == pat_id, f"Get patient details failed: {details}"
    print(f"    Patient dossier retrieved: #{details['id']} ({details['name']})")

    print(f"[5] Testing /patients/{pat_id} (PUT)...")
    update_data = {
        "name": "E2E Test Patient (Updated)",
        "age": 50,
        "gender": "Female",
        "blood_pressure_sys": 128,
        "blood_pressure_dia": 82,
        "cholesterol": 200,
        "risk_category": "Low risk"
    }
    status, updated = put(f"/patients/{pat_id}", update_data)
    assert status == 200 and updated["patient"]["name"] == "E2E Test Patient (Updated)", f"Update failed: {updated}"
    print(f"    Updated patient: {updated['patient']['name']}")

    print("[6] Testing /wellness/screenings (POST)...")
    screening_data = {
        "patient_id": pat_id,
        "heart_rate_bpm": 71,
        "hrv_rmssd_ms": 52,
        "stress_index": 28,
        "stress_level": "Balanced",
        "confidence": 0.96,
        "guidance_notes": "Optimal parasympathetic modulation detected."
    }
    status, screening = post("/wellness/screenings", screening_data)
    assert status == 201 and "screening_id" in screening, f"Save screening failed: {screening}"
    print(f"    Screening recorded: {screening['screening_id']}")

    print("[7] Testing /wellness/screenings (GET)...")
    status, screenings = get("/wellness/screenings")
    assert status == 200 and len(screenings) >= 1, f"Get screenings failed: {screenings}"
    print(f"    Retrieved {len(screenings)} total wellness records.")

    print("[8] Testing /mri/external-validation (GET)...")
    status, report = get("/mri/external-validation")
    assert status == 200 and "benchmark_name" in report, f"External report failed: {report}"
    print(f"    Benchmark: {report['benchmark_name']}")
    print(f"    Summary: {report['summary']}")

    print(f"[9] Testing /patients/{pat_id} (DELETE)...")
    status, del_res = delete(f"/patients/{pat_id}")
    assert status == 200 and "deleted successfully" in del_res.get("message", ""), f"Delete failed: {del_res}"
    print(f"    Deleted temporary patient #{pat_id} successfully.")

    print("\n>>> ALL 9 END-TO-END BACKEND API TESTS PASSED! <<<")

if __name__ == "__main__":
    run_tests()
