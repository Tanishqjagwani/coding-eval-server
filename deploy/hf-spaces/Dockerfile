FROM oven/bun:1-debian

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    git \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 (required for Claude Code CLI subprocess)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages that Claude may use during evaluations
RUN pip3 install --break-system-packages --no-cache-dir \
    pandas \
    openpyxl

# Install Claude Code CLI globally (spawned by @anthropic-ai/claude-agent-sdk)
RUN npm install -g @anthropic-ai/claude-code

# Install Codex CLI globally (spawned by CodexProvider)
RUN npm install -g @openai/codex

# Create non-root user (Claude Code CLI refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash appuser

WORKDIR /app

# Install bun dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Copy application source
COPY src/ ./src/

# Give appuser ownership of the app directory
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Hugging Face Spaces requires port 7860
ENV PORT=7860

EXPOSE 7860

CMD ["bun", "run", "src/index.ts"]
