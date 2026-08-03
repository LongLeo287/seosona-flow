# SEOSONA Flow 23 Workflow Import Audit

Date: 2026-07-27

## Result

- Imported workflow count: 23
- Imported node count: 249
- Imported edge count: 304
- Import schema: seosona.backup.v1
- Storage keys: af_workflows, af_nodes, af_edges
- Runtime state reset: workflow and node statuses set to pending; generated results and error fields removed.
- Identity hygiene: user/account/session/auth fields removed.
- Brand/domain hygiene: external source brand and backend domain strings scrubbed before writing files.
- ID strategy: new SEOSONA import IDs generated for every workflow, node, and edge to avoid overwriting existing local items.

## Workflow Inventory

| # | Workflow | Nodes | Edges | Flow Project |
|---:|---|---:|---:|---|
| 1 | Workflow - Korean Baseball Fan-Cam Shot (Fan-cam bóng chày Hàn Quốc) (copy) | 5 | 4 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 2 | Workflow - TikTok Livestream Selling Video (Video livestream bán hàng TikTok) (copy) | 4 | 5 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 3 | Workflow - Cinematic Fitness Training Video (Video tập luyện fitness điện ảnh) (copy) | 6 | 9 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 4 | Workflow - Stickman Video (Video người que) (copy) | 9 | 6 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 5 | Workflow - Anime Fitness Storyboard Video (copy) | 17 | 20 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 6 | Workflow - Street Fashion Style Video (Video thời trang đường phố) (copy) | 6 | 5 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 7 | Workflow - Photo to Living Sticker Video (Biến ảnh thành sticker chuyển động) (copy) | 9 | 8 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 8 | Workflow - Handbag Review Video (Video review túi xách) (copy) | 13 | 14 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 9 | Workflow - Cinematic Brand Story Video (Video thương hiệu điện ảnh) (copy) | 7 | 6 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 10 | Workflow - Luxury Men's Fashion Lookbook (Lookbook thời trang nam sang trọng) (copy) | 12 | 17 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 11 | Sneaker Commercial Video Workflow (Workflow Tạo Video Quảng Cáo Giày) (copy) | 12 | 14 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 12 | Floating Fruit Bubble Video Workflow (Workflow Tạo Video Trái Cây Trong Bong Bóng Bay) (copy) | 5 | 4 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 13 | Workflow Tom & Jerry: Cinematic Garage Reveal (Tom & Jerry: Màn Xuất Hiện Điện Ảnh Trong Hầm Xe) (copy) | 10 | 13 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 14 | Prehistoric Clay 3D - Automation (copy) | 21 | 30 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 15 | Prehistoric Stickman - Workflow Automation (copy) | 21 | 27 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 16 | Street Cleanup Timelapse - Workflow Timelapse Dọn Vệ Sinh Đường Phố (copy) | 13 | 19 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 17 | 3D Clay Stickman Prompt Generator Workflow (copy) | 23 | 41 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 18 | Honey Bee POV Workflow (copy) | 8 | 6 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 19 | Building Timelapse (copy) | 14 | 21 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 20 | Elevator Fashion Video Workflow (Workflow Tạo Video Thời Trang Thang Máy) (copy) | 7 | 6 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 21 | Workflow - Office Fashion Lookbook Video (Video lookbook thời trang công sở) (copy) | 12 | 14 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 22 | Escalator Fashion Video Workflow - Thời trang trên thanh cuốn (copy) | 7 | 6 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |
| 23 | Workflow - Elevator Mirror Outfit Check (Outfit check gương thang máy) (copy) | 8 | 9 | f2e7c842-13ab-4615-ab30-585a0e6a5733 |

## Import Instructions

1. Open SEOSONA Flow Settings.
2. Go to Backup and Restore.
3. Choose Import backup.
4. Select the JSON backup file generated in `imports/`.
5. Use merge mode so existing workflows remain untouched.

## Compatibility Notes

- Workflow graph links were remapped to the new node IDs.
- Flow project IDs were preserved when present, because they are required for provider-side project continuity.
- Uploaded reference media IDs were preserved when present; generated result media was removed as runtime output.
- If an imported workflow depends on an expired provider-side media reference, reattach that reference image/video inside SEOSONA Flow before running.
