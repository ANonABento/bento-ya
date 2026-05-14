#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(clippy::all)]

fn main() {
    kaitencode_lib::run()
}
