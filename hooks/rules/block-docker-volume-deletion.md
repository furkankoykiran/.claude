---
name: block-docker-volume-deletion
enabled: true
event: bash
pattern: docker\s+volume\s+(rm|prune)|docker.*-v.*rm|docker-compose.*down.*-v|docker\s+compose\s+.*down.*--volumes
action: block
---

🛑 **BLOCKED: Docker Volume Deletion Detected**

This operation would delete Docker volumes containing persistent data and CANNOT be undone.

## Blocked Commands

### Direct Volume Deletion
- `docker volume rm`
- `docker volume prune`
- `docker volume rm -f`

### Docker Compose with Volume Removal
- `docker-compose down -v`
- `docker compose down --volumes`
- `docker compose down -volumes`

### Any Docker Command with Volume Deletion
- Any docker command combining `-v` flag with removal operations

## Why This Is Blocked

Docker volumes contain:
- **Production databases** and their data
- **Application state** and configuration
- **User uploads** and generated content
- **Persistent storage** that cannot be recovered without backups

## Safe Alternatives

### 1. Backup First
```bash
# Create backup before deletion
docker run --rm -v volume_name:/data -v $(pwd):/backup alpine tar czf /backup/backup.tar.gz /data
```

### 2. Use Specific Volume Names
```bash
# List volumes first
docker volume ls

# Remove ONLY the specific volume (outside Claude Code)
docker volume rm specific_volume_name
```

### 3. Inspect Before Deletion
```bash
# Check what's in the volume
docker volume inspect volume_name

# View usage
docker ps -a --filter volume=volume_name
```

### 4. Use docker-compose Without -v
```bash
# Stop containers without removing volumes
docker-compose down

# Or: Remove containers but keep volumes
docker-compose rm -f
```

## If You Absolutely Must Delete

These protections exist for YOUR safety. If you need to delete a volume:

1. **Exit Claude Code** and run the command in your terminal directly
2. **Verify the exact volume name** - no wildcards
3. **Confirm you have a backup** of important data
4. **Understand data will be permanently lost**

> **NOTE:** This operation can NEVER be performed through Claude Code.
> The protections are in place to prevent accidental data loss.
