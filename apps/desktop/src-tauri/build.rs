fn main() {
    let directory = std::path::Path::new("icons");
    std::fs::create_dir_all(directory).unwrap();
    let mut icon = vec![0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0];
    icon.extend_from_slice(&4264u32.to_le_bytes());
    icon.extend_from_slice(&22u32.to_le_bytes());
    icon.extend_from_slice(&40u32.to_le_bytes());
    icon.extend_from_slice(&32u32.to_le_bytes());
    icon.extend_from_slice(&64u32.to_le_bytes());
    icon.extend_from_slice(&1u16.to_le_bytes());
    icon.extend_from_slice(&32u16.to_le_bytes());
    icon.extend_from_slice(&[0u8; 24]);
    for y in (0..32).rev() { for x in 0..32 {
        let letter = (9..13).contains(&x) && (7..26).contains(&y)
            || (9..24).contains(&x) && (7..11).contains(&y)
            || (9..21).contains(&x) && (15..19).contains(&y);
        icon.extend_from_slice(if letter { &[255,255,255,255] } else { &[86,103,45,255] });
    }}
    icon.extend_from_slice(&[0u8; 128]);
    std::fs::write(directory.join("icon.ico"), icon).unwrap();
    tauri_build::build()
}
