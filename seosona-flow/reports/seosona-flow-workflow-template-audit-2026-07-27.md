# SEOSONA Flow Workflow Template Audit - 2026-07-27

## Executive summary

- T?ng template ?ang load trong Spaces > Templates: 88.
- Workflow usable sau chu?n ho?: 88.
- Workflow video: 29.
- Workflow h?nh ?nh: 59.
- T?ng node: 593.
- T?ng edge: 618.
- Edge g?y: 0.
- Template thi?u metadata: 0.
- Template c? thumbnail th?t: 14.
- Template d?ng generated cover fallback: 74.

## Tag taxonomy update

- Tag hi?n ch? m? t? lo?i ??u ra, l?nh v?c, ??nh d?ng, phong c?ch ho?c use-case.
- ?? lo?i b? tag v?n h?nh ho?c node-capability nh? `workflow`, `t?i xu?ng`, `C? Download`, `C? prompt AI`, `C? ?nh tham chi?u`, t?n node `Prompt`, `Flow - Generate`.
- Detail modal d?ng `template.tags` ?? curate thay v? t? sinh chip t? node.
- Th?ng tin v?n h?nh nh? s? node v?n n?m ? metadata ri?ng, kh?ng tr?n v?o tag.

## UI fixes covered by this audit

- M? t?/category/tag ?? chuy?n v? ti?ng Vi?t cho template ch?nh; template extra gi? m? t? ti?ng Vi?t v? category prefix ti?ng Vi?t.
- Detail modal kh?ng c?n render to?n b? node name th?nh tag/chip r?c; thay b?ng tag taxonomy th?t t? metadata.
- Template thi?u thumbnail th?t s? c? generated cover trong card, detail modal v? confirm modal.

## Full template inventory

| ID | Source | Status | Media | Category | Nodes | Edges | Downloads | Cover | Name | Tags |
|---:|---|---|---|---|---:|---:|---:|---|---|---|
| 1 | main | usable | Video | Video — Fan-cam bóng chày Hàn Quốc | 6 | 5 | 1 | thumbnail | Fan-cam bóng chày Hàn Quốc | video, fan-cam, thể thao |
| 6 | main | usable | Video | Video — Livestream bán hàng TikTok | 5 | 6 | 1 | thumbnail | Livestream bán hàng TikTok | video, livestream, TikTok |
| 7 | main | usable | Video | Video — Tập luyện fitness điện ảnh | 7 | 11 | 1 | thumbnail | Tập luyện fitness điện ảnh | video, fitness, điện ảnh |
| 8 | main | usable | Video | Video — người que | 10 | 9 | 1 | thumbnail | Video người que | video, người que |
| 9 | main | usable | Video | Video — Anime fitness storyboard | 18 | 24 | 1 | thumbnail | Anime fitness storyboard | video, fitness, anime, storyboard |
| 10 | main | usable | Video | Video — thời trang đường phố | 7 | 6 | 1 | thumbnail | Video thời trang đường phố | video, thời trang |
| 14 | main | usable | Video | Video — Biến ảnh thành sticker chuyển động | 10 | 12 | 1 | thumbnail | Biến ảnh thành sticker chuyển động | video, sticker, chuyển động |
| 15 | main | usable | Video | Video — review túi xách | 14 | 16 | 1 | thumbnail | Video review túi xách | video, túi xách |
| 16 | main | usable | Video | Video — thương hiệu điện ảnh | 8 | 7 | 1 | thumbnail | Video thương hiệu điện ảnh | video, thương hiệu, điện ảnh |
| 13 | main | usable | Video | Video — Lookbook thời trang nam sang trọng | 13 | 18 | 1 | thumbnail | Lookbook thời trang nam sang trọng | video, thời trang, lookbook |
| 2 | main | usable | Video | Video — quảng cáo giày sneaker | 13 | 16 | 1 | generated | Video quảng cáo giày sneaker | video, sneaker, giày, quảng cáo |
| 3 | main | usable | Video | Video — trái cây trong bong bóng bay | 6 | 5 | 1 | generated | Video trái cây trong bong bóng bay | video, bubble hero |
| 4 | main | usable | Image | Ảnh — Tom & Jerry — garage reveal điện ảnh | 11 | 15 | 1 | generated | Tom & Jerry — garage reveal điện ảnh | ảnh, điện ảnh, garage |
| 5 | main | usable | Video | Video — Đất sét tiền sử 3D | 22 | 34 | 1 | generated | Đất sét tiền sử 3D | video, đất sét, 3D |
| 17 | main | usable | Video | Video — Người que tiền sử | 22 | 34 | 1 | generated | Người que tiền sử | video, người que |
| 18 | main | usable | Video | Video — Timelapse dọn vệ sinh đường phố | 14 | 21 | 1 | generated | Timelapse dọn vệ sinh đường phố | video, timelapse |
| 19 | main | usable | Video | Video — Tạo prompt người que đất sét 3D | 24 | 45 | 1 | generated | Tạo prompt người que đất sét 3D | video, người que, đất sét, 3D |
| 20 | main | usable | Video | Video — POV ong mật | 9 | 7 | 1 | generated | POV ong mật | video, POV |
| 21 | main | usable | Video | Video — Timelapse xây dựng | 15 | 24 | 1 | generated | Timelapse xây dựng | video, timelapse |
| 22 | main | usable | Video | Video — thời trang thang máy | 8 | 7 | 1 | thumbnail | Video thời trang thang máy | video, thời trang, thang máy |
| 12 | main | usable | Video | Video — Lookbook thời trang công sở | 13 | 16 | 1 | thumbnail | Lookbook thời trang công sở | video, thời trang, lookbook |
| 23 | main | usable | Video | Video — thời trang trên thang cuốn | 8 | 7 | 1 | thumbnail | Video thời trang trên thang cuốn | video, thời trang, thang cuốn |
| 11 | main | usable | Video | Video — Outfit check gương thang máy | 9 | 11 | 1 | thumbnail | Outfit check gương thang máy | video, outfit, thang máy |
| 24 | main | usable | Video | Video — Ad Pain-Point → video clip | 3 | 2 | 1 | generated | Ad Pain-Point → video clip | video, quảng cáo |
| 25 | main | usable | Image | Ảnh — E-commerce → bộ PDP 10 ảnh | 4 | 3 | 1 | generated | E-commerce → bộ PDP 10 ảnh | ảnh, sản phẩm, TMĐT, PDP |
| 26 | main | usable | Video | Video — Cinematic reel (Seedance + chữ ký đạo diễn) | 3 | 2 | 1 | generated | Cinematic reel (Seedance + chữ ký đạo diễn) | video, điện ảnh, reel |
| 27 | main | usable | Video | Video — Kịch bản → ảnh mở đầu + video chuyển động (2 lớp) | 5 | 4 | 1 | generated | Kịch bản → ảnh mở đầu + video chuyển động (2 lớp) | video, chuyển động, kịch bản, keyframe |
| 28 | main | usable | Image | Ảnh — KOC → bảng thiết kế nhân vật (6 panel) | 4 | 3 | 1 | generated | KOC → bảng thiết kế nhân vật (6 panel) | ảnh, KOC, nhân vật, panel |
| 29 | main | usable | Image | Ảnh — Poster thương mại phân lớp | 3 | 2 | 1 | generated | Poster thương mại phân lớp | ảnh, poster, marketing |
| 30 | main | usable | Image | Ảnh — Halftone collage series | 3 | 2 | 1 | generated | Halftone collage series | ảnh, series, halftone |
| 31 | main | usable | Image | Ảnh — Concept → 4 tỉ lệ (multi-platform) | 4 | 3 | 1 | generated | Concept → 4 tỉ lệ (multi-platform) | ảnh, đa nền tảng |
| 32 | main | usable | Image | Ảnh — Subject → 4 phong cách | 4 | 3 | 1 | generated | Subject → 4 phong cách | ảnh, chủ thể, phong cách |
| 33 | main | usable | Image | Ảnh — Sản phẩm → 4 góc chụp | 5 | 4 | 1 | generated | Sản phẩm → 4 góc chụp | ảnh, sản phẩm, đa góc |
| 34 | main | usable | Image | Ảnh — Chủ đề → carousel nhiều slide | 4 | 3 | 1 | generated | Chủ đề → carousel nhiều slide | ảnh, carousel, marketing |
| 35 | main | usable | Image | Ảnh — Thương hiệu → bộ visual đồng bộ (brand kit) | 4 | 3 | 1 | generated | Thương hiệu → bộ visual đồng bộ (brand kit) | ảnh, thương hiệu |
| 36 | main | usable | Image | Ảnh — Ánh sáng explorer (1 cảnh → 4 setup) | 4 | 3 | 1 | generated | Ánh sáng explorer (1 cảnh → 4 setup) | ảnh, ánh sáng |
| 37 | main | usable | Image | Ảnh — Poster chữ chuẩn (chừa vùng → phủ chữ) | 5 | 4 | 1 | generated | Poster chữ chuẩn (chừa vùng → phủ chữ) | ảnh, poster, marketing |
| 38 | main | usable | Image | Tiện ích — Storyboard → nhiều ảnh (batch) | 4 | 3 | 1 | generated | Storyboard → nhiều ảnh (batch) | ảnh, storyboard, batch |
| 39 | main | usable | Image | Ảnh — 1 concept → N biến thể (variant) | 4 | 3 | 1 | generated | 1 concept → N biến thể (variant) | ảnh, biến thể |
| 40 | main | usable | Image | Ảnh — Try-on sản phẩm trên người mẫu | 4 | 3 | 1 | generated | Try-on sản phẩm trên người mẫu | ảnh, sản phẩm, try-on |
| 41 | main | usable | Image | Ảnh — Character sheet (nhất quán nhân vật) | 4 | 3 | 1 | generated | Character sheet (nhất quán nhân vật) | ảnh, nhân vật |
| 42 | main | usable | Image | Ảnh — Before / After (so sánh) | 3 | 2 | 1 | generated | Before / After (so sánh) | ảnh, before/after |
| 43 | main | usable | Image | Ảnh — Thumbnail YouTube CTR (chữ chuẩn) | 5 | 4 | 1 | generated | Thumbnail YouTube CTR (chữ chuẩn) | ảnh, thumbnail, YouTube |
| 44 | main | usable | Image | Tiện ích — Truyện tranh nhiều panel (comic) | 4 | 3 | 1 | generated | Truyện tranh nhiều panel (comic) | ảnh, truyện tranh, panel |
| 45 | main | usable | Image | Ảnh — Logo / mascot — bộ biến thể | 4 | 3 | 1 | generated | Logo / mascot — bộ biến thể | ảnh, biến thể, logo, mascot |
| 46 | main | usable | Image | Tiện ích — QA chữ trong ảnh | 4 | 3 | 1 | generated | QA chữ trong ảnh | ảnh, chữ trong ảnh, QA |
| 1001 | extra | usable | Image | Ảnh — Pipeline sinh ảnh | 7 | 7 | 1 | generated | ⭐ Ý tưởng → base keyframe → chuỗi scene nhất quán | ảnh, pipeline, scene, batch, nhất quán |
| 1002 | extra | usable | Image | Tiện ích — Storyboard | 4 | 3 | 1 | generated | Storyboard 8-panel → batch generate | ảnh, storyboard, batch, kể chuyện, 8-panel |
| 1003 | extra | usable | Image | Ảnh — Nhân vật | 7 | 7 | 1 | generated | Character board KOC (2 tầng): sheet base → 6 pose nhất quán | ảnh, nhân vật, koc, nhất quán, pose |
| 1004 | extra | usable | Image | Tiện ích — Đa provider | 5 | 6 | 1 | generated | 1 prompt → so sánh 3 model (Flow/ChatGPT/Grok) | ảnh, so sánh, so sánh model, flow, chatgpt, grok |
| 1005 | extra | usable | Image | Tiện ích — Đa dạng hoá | 8 | 7 | 1 | generated | Random style → đa dạng hoá gen | ảnh, ngẫu nhiên, phong cách, biến thể |
| 1006 | extra | usable | Image | Tiện ích — Prompt động | 5 | 4 | 1 | generated | Text Template: brand + sản phẩm → prompt động | ảnh, prompt động, thương hiệu, sản phẩm |
| 1007 | extra | usable | Image | Tiện ích — Điều khiển luồng | 5 | 4 | 1 | generated | Condition: rẽ nhánh theo prompt | ảnh, rẽ nhánh, logic |
| 1008 | extra | usable | Image | Ảnh — Sản phẩm | 4 | 3 | 1 | generated | Sản phẩm → bộ 4 góc nhất quán | ảnh, sản phẩm, góc, e-commerce |
| 1009 | extra | usable | Image | Ảnh — E-commerce | 7 | 7 | 1 | generated | Sản phẩm → listing Shopee (2 tầng: hero → 6 ảnh) | ảnh, shopee, listing, e-commerce, sản phẩm |
| 1010 | extra | usable | Image | Ảnh — F&B | 4 | 3 | 1 | generated | Quán ăn → bộ ảnh menu đồng bộ | ảnh, menu, món ăn, nhà hàng |
| 1011 | extra | usable | Image | Ảnh — UGC / KOL | 4 | 2 | 1 | generated | UGC / KOL quảng cáo sản phẩm | ảnh, ugc, koc, review, social |
| 1012 | extra | usable | Image | Ảnh — Thương hiệu | 4 | 3 | 1 | generated | Thương hiệu → bộ visual đồng bộ (brand kit) | ảnh, thương hiệu, kit, nhận diện |
| 1013 | extra | usable | Image | Ảnh — Social | 4 | 3 | 1 | generated | Chủ đề → carousel nhiều slide | ảnh, carousel, social, slide |
| 1014 | extra | usable | Image | Ảnh — Marketing mùa vụ | 4 | 3 | 1 | generated | Sản phẩm → chiến dịch theo mùa/lễ (Tết) | ảnh, tết, chiến dịch, mùa vụ |
| 1015 | extra | usable | Image | Tiện ích — Tiện ích prompt | 4 | 3 | 1 | generated | Ý tưởng tiếng Việt → prompt EN chuẩn → generate | ảnh, dịch prompt, tiếng Việt, prompt AI |
| 1016 | extra | usable | Image | Ảnh — Pipeline sinh ảnh | 5 | 4 | 1 | generated | ⭐ Ý tưởng → AI scene → Prompt Sequence → batch gen | ảnh, pipeline, chuỗi prompt, batch, nhất quán |
| 1017 | extra | usable | Image | Tiện ích — Tutorial | 5 | 4 | 1 | generated | Công thức → bộ ảnh từng bước | ảnh, công thức, tutorial, bước, ẩm thực |
| 1018 | extra | usable | Image | Ảnh — Thời trang | 5 | 4 | 1 | generated | Bộ sưu tập → lookbook nhất quán | ảnh, lookbook, thời trang, nhất quán |
| 1019 | extra | usable | Image | Ảnh — Du lịch | 5 | 4 | 1 | generated | Điểm đến → chuỗi ảnh du lịch | ảnh, du lịch, series |
| 1020 | extra | usable | Image | Ảnh — Văn hoá VN | 5 | 4 | 1 | generated | 12 con giáp → bộ ảnh đồng bộ | ảnh, con giáp, tết, bộ, lịch |
| 1021 | extra | usable | Image | Ảnh — Sticker | 5 | 4 | 1 | generated | Nhân vật → bộ emoji/reaction sticker | ảnh, emoji, sticker, nhân vật |
| 1022 | extra | usable | Image | Ảnh — Creator | 5 | 4 | 1 | generated | Kênh YouTube → bộ nhận diện | ảnh, youtube, banner, thumbnail, nhận diện |
| 1023 | extra | usable | Image | Ảnh — Marketing | 5 | 4 | 1 | generated | Ngành dọc → bộ ảnh marketing đồng bộ | ảnh, ngành dọc, marketing, thương hiệu |
| 1024 | extra | usable | Image | Ảnh — Cưới | 5 | 4 | 1 | generated | Chủ đề cưới → bộ ảnh concept | ảnh, cưới, album |
| 1025 | extra | usable | Image | Ảnh — Bất động sản | 5 | 4 | 1 | generated | Bất động sản → bộ ảnh các phòng | ảnh, bất động sản, nội thất, tour |
| 1026 | extra | usable | Image | Ảnh — Quảng cáo | 5 | 4 | 1 | generated | Sản phẩm → chuỗi ảnh kể chuyện quảng cáo | ảnh, quảng cáo, kể chuyện |
| 1027 | extra | usable | Image | Ảnh — Sản phẩm | 5 | 4 | 1 | generated | Sản phẩm → bộ ảnh xoay 360 | ảnh, 360, sản phẩm, đa góc |
| 1028 | extra | usable | Image | Ảnh — Đa nền tảng | 5 | 4 | 1 | generated | 1 thiết kế → nhiều tỉ lệ (đa nền tảng) | ảnh, ratio, đa nền tảng |
| 1029 | extra | usable | Image | Ảnh — Nhân vật | 7 | 7 | 1 | generated | Nhân vật → "một ngày" (2 tầng: base → 6 khoảnh khắc) | ảnh, một ngày, nhân vật, kể chuyện |
| 1030 | extra | usable | Video | Video — Video — Thiên nhiên | 5 | 4 | 1 | generated | POV thiên nhiên → chuỗi cảnh video | video, pov, thiên nhiên |
| 1031 | extra | usable | Video | Video — Video — Timelapse | 5 | 4 | 1 | generated | Timelapse tư liệu → chuỗi khung | video, timelapse, tư liệu |
| 1032 | extra | usable | Image | Ảnh — Nhân vật | 5 | 4 | 1 | generated | Nhân vật 2D nhất quán → series cảnh | ảnh, nhân vật, 2d, series |
| 1033 | extra | usable | Image | Ảnh — Nhân vật | 5 | 4 | 1 | generated | Nhân vật đất nặn 3D → series | ảnh, đất sét, 3d, nhân vật |
| 1034 | extra | usable | Video | Video — Video — Quảng cáo | 5 | 4 | 1 | generated | Quảng cáo sản phẩm điện ảnh → chuỗi shot | video, quảng cáo, điện ảnh |
| 1035 | extra | usable | Image | Ảnh — Sản phẩm | 5 | 4 | 1 | generated | Sản phẩm bay bổng trong bong bóng → hero | ảnh, bubble hero, hero, sản phẩm |
| 1036 | extra | usable | Image | Ảnh — Sản phẩm | 5 | 4 | 1 | generated | Showcase giày đa góc điện ảnh | ảnh, sneaker, giày, showcase |
| 1037 | extra | usable | Video | Video — Video — Tư liệu | 5 | 4 | 1 | generated | Tư liệu động vật hoang dã → chuỗi cảnh | video, động vật, tư liệu |
| 1038 | extra | usable | Image | Ảnh — Model + sản phẩm (ref) | 11 | 10 | 1 | generated | Model thể thao (2 tầng): tạo model gốc → mặc đồ full-body | ảnh, model, trang phục, lookbook, nhất quán, ảnh ref |
| 1039 | extra | usable | Image | Ảnh — Sản phẩm cao cấp (ref) | 7 | 7 | 1 | generated | Sản phẩm cao cấp (2 tầng): chính diện → đa góc nhất quán | ảnh, sản phẩm, đa góc, showcase, ảnh ref, cao cấp |
| 1040 | extra | usable | Image | Ảnh — Model + sản phẩm (ref) | 9 | 8 | 1 | generated | Model cầm sản phẩm (2 tầng): tạo model → ghép sản phẩm | ảnh, model, cầm sản phẩm, quảng cáo, ảnh ref |
| 1041 | extra | usable | Image | Tiện ích — Storyboard video (ref) | 6 | 5 | 1 | generated | Sản phẩm → storyboard video (2 tầng: kịch bản → grid 3x3) | ảnh, storyboard, video, storyboard grid, sản phẩm, ảnh ref |
| 1042 | extra | usable | Image | Ảnh — Chiến dịch nhóm (ref) | 9 | 8 | 1 | generated | Nhóm model + sản phẩm → chiến dịch (2 tầng) | ảnh, chiến dịch, nhóm model, sản phẩm, ảnh ref |
