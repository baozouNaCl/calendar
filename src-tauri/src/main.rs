// Desktop executable bootstrap.
// Keeps platform-specific startup minimal and forwards all real runtime setup
// to src/lib.rs so the shell wiring stays centralized.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    chronicle_calendar_lib::run();
}
