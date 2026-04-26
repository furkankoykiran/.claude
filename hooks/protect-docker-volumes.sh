#!/bin/bash
# Claude Code Hook: Protect Docker Volumes from Deletion
# This script blocks docker commands that delete volumes

# Read JSON input from stdin
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")

# Skip if no command
if [[ -z "$COMMAND" ]]; then
    exit 0
fi

# Skip if command doesn't start with docker
if [[ ! "$COMMAND" =~ ^[[:space:]]*docker ]]; then
    exit 0
fi

# Convert to lowercase for pattern matching
COMMAND_LOWER=$(echo "$COMMAND" | tr '[:upper:]' '[:lower:]')

# Block docker volume deletion commands
if echo "$COMMAND_LOWER" | grep -qE "docker\s+volume\s+rm|docker\s+volume\s+prune|docker\s+.*\s-v\s+.*rm|docker\s+.*\s--volumes\s+.*rm"; then
    cat >&2 << 'EOF'
🛑 BLOCKED: Docker Volume Deletion Detected

This operation would delete Docker volumes containing persistent data.

BLOCKED COMMANDS:
  - docker volume rm
  - docker volume prune
  - Any docker command with -v that removes volumes

REASON: Docker volumes contain databases, application data, and other
persistent information that CANNOT be recovered without backups.

ALTERNATIVES:
  1. Backup the volume first: docker run --rm -v vol_name:/data -v $(pwd):/backup alpine tar czf /backup/backup.tar.gz /data
  2. Use specific volume names (never wildcards)
  3. Review volume contents before deletion

If you ABSOLUTELY must delete a volume, you'll need to:
  1. Run this command outside of Claude Code
  2. Verify the exact volume name
  3. Confirm you have a backup
EOF
    exit 2  # Non-zero exit blocks the operation
fi

# Block docker-compose with -v flag
if echo "$COMMAND_LOWER" | grep -qE "docker-compose\s+.*down.*-v|docker\s+compose\s+.*down.*--volumes|docker\s+compose\s+.*down.*-volumes"; then
    cat >&2 << 'EOF'
🛑 BLOCKED: Docker Volume Deletion via Compose Detected

This operation would delete volumes when removing containers.

BLOCKED COMMANDS:
  - docker-compose down -v
  - docker compose down --volumes
  - docker compose down -volumes

REASON: The -v / --volumes flag removes named volumes declared in
the docker-compose.yml file. These volumes contain persistent data.

ALTERNATIVES:
  1. Run: docker-compose down (without -v)
  2. Backup volumes first
  3. Remove specific volumes manually after confirming

If you ABSOLUTELY must delete volumes, run the command outside of
Claude Code after verifying you have backups.
EOF
    exit 2  # Non-zero exit blocks the operation
fi

# Direct directory deletion of Docker volumes
if echo "$COMMAND_LOWER" | grep -qE "rm\s+-rf\s+/var/lib/docker/volumes|rm\s+-rf\s+.*/docker/volumes"; then
    cat >&2 << 'EOF'
🛑 BLOCKED: Direct Docker Volume Directory Deletion Detected

This would delete the Docker volumes directory directly.

BLOCKED: rm -rf /var/lib/docker/volumes or similar paths

REASON: Direct deletion of Docker volume directories can:
  - Corrupt Docker's state
  - Cause data loss for ALL containers
  - Break Docker daemon functionality

ALTERNATIVES:
  1. Use docker volume ls to list volumes
  2. Use docker volume inspect to check contents
  3. Use docker volume rm <specific_name> outside Claude Code

This operation can NEVER be performed through Claude Code.
EOF
    exit 2  # Non-zero exit blocks the operation
fi

# Allow all other commands
exit 0
