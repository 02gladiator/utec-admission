#!/bin/sh
set -eu

backup_root=/backups
daily_dir="$backup_root/daily"
weekly_dir="$backup_root/weekly"
interval_seconds="${BACKUP_INTERVAL_SECONDS:-21600}"

mkdir -p "$daily_dir" "$weekly_dir"

create_backup() {
  timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  backup_file="$daily_dir/utec-$timestamp.dump"

  echo "Creating PostgreSQL backup: $backup_file"
  pg_dump --format=custom --compress=6 --file="$backup_file" "$POSTGRES_DB"

  # Keep the 14 most recent regular copies.
  find "$daily_dir" -maxdepth 1 -type f -name '*.dump' -print \
    | sort -r \
    | tail -n +15 \
    | xargs -r rm -f

  # Keep one copy per ISO week, for eight weeks.
  week_file="$weekly_dir/utec-week-$(date -u +%G-%V).dump"
  cp "$backup_file" "$week_file"
  find "$weekly_dir" -maxdepth 1 -type f -name '*.dump' -print \
    | sort -r \
    | tail -n +9 \
    | xargs -r rm -f
}

while true; do
  create_backup
  echo "Next PostgreSQL backup in $interval_seconds seconds."
  sleep "$interval_seconds"
done
