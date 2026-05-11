#![deny(clippy::all)]

use bento_ya_lib::db;

fn main() {
    let db_path = db::db_path();

    match db::init() {
        Ok(conn) => {
            let migration_count = conn
                .query_row("SELECT COUNT(*) FROM _migrations", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap_or(0);

            println!(
                "Applied Bento-ya migrations to {} ({} recorded migrations).",
                db_path.display(),
                migration_count
            );
        }
        Err(error) => {
            eprintln!(
                "Failed to apply Bento-ya migrations to {}: {}",
                db_path.display(),
                error
            );
            std::process::exit(1);
        }
    }
}
