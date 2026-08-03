# Backup Policy

PostgreSQL is the authoritative source. Backups use `pg_dump` custom format, are checksum recorded, encrypted by the platform storage layer and retained according to the approved retention schedule. Redis is transport/cache only and is not a database backup substitute.

Required evidence: successful backup metadata, checksum verification, restore timestamp, row/integrity checks and operator approval. Production backup/restore requires an explicit `BACKUP_ALLOW_PRODUCTION=true` control set by the operator.
