FROM python:3.12-slim

WORKDIR /app

# System deps (none needed for pure-Python stack, but keep layer for future use)
RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code
COPY bot/ bot/

# Non-root user
RUN useradd --create-home appuser
USER appuser

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

CMD ["python", "-m", "bot.main"]
