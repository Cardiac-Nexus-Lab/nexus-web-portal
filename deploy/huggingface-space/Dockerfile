# Cardiac Nexus API on a Hugging Face Space (Docker SDK, free CPU tier).
# The image clones both public repositories, so a rebuild picks up whatever is
# on main. The ADD lines fetch each branch's current commit: when it changes,
# Docker's cache is invalidated from that point and the clone runs again.
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git libgomp1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

# Spaces run as user 1000
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /home/user/app

# CPU-only PyTorch is a fraction of the size of the default CUDA build
RUN pip install --no-cache-dir --user torch --index-url https://download.pytorch.org/whl/cpu

ADD --chown=user https://api.github.com/repos/Cardiac-Nexus-Lab/nexus-ai-engine/git/refs/heads/main /tmp/engine-version.json
ADD --chown=user https://api.github.com/repos/Cardiac-Nexus-Lab/nexus-web-portal/git/refs/heads/main /tmp/web-version.json
RUN git clone --depth 1 https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine.git \
 && git clone --depth 1 https://github.com/Cardiac-Nexus-Lab/nexus-web-portal.git
RUN pip install --no-cache-dir --user -r nexus-web-portal/backend/requirements.txt

WORKDIR /home/user/app/nexus-web-portal/backend
# Overridden by the DATABASE_URL secret once a hosted PostgreSQL database is set;
# until then analyses are kept in a file that resets when the Space restarts.
ENV DATABASE_URL=sqlite:////tmp/cardiac_nexus.db

EXPOSE 7860
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
