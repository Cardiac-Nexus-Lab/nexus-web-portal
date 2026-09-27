---
title: Cardiac Nexus API
emoji: 🫀
colorFrom: red
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
short_description: Backend API for the Cardiac Nexus research prototype
---

# Cardiac Nexus API

The FastAPI backend of [Cardiac Nexus](https://github.com/Cardiac-Nexus-Lab/nexus-web-portal),
a final-year engineering project at SJC Institute of Technology: ECG and cardiac MRI
models with explanations, and PDF reports. The website calls it through `/api`.

**Research prototype.** Not a medical device, not validated for clinical use.

The image is built from the Dockerfile here, which clones
[nexus-web-portal](https://github.com/Cardiac-Nexus-Lab/nexus-web-portal) and
[nexus-ai-engine](https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine). To deploy new
code, push to those repositories and choose **Settings → Factory rebuild** here.

Settings: `FIREBASE_PROJECT_ID` (variable) and `DATABASE_URL` (secret, a hosted
PostgreSQL connection string).
