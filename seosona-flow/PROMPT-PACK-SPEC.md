# Prompt Pack contract (v1) — SEOSONA Flow

Mục tiêu: **bất kỳ nguồn nào** (bạn tự soạn, một công cụ phân tích repo ngoài như SEOSONA OS, hoặc thủ công)
**xuất ra 1 file JSON** theo schema dưới đây. File này được bundle **tĩnh** vào SEOSONA Flow — các prompt/skill
tự nạp vào **kho prompt** (My Prompts) và dùng lại trong Prompt Assistant.

> **Quan trọng:** extension KHÔNG phụ thuộc nguồn nào lúc chạy. `prompt-pack.json` chỉ là **dữ liệu tĩnh đầu vào
> lúc build** (giống cách bundle styles/workflows). Có pack thì kho có sẵn prompt; không có thì extension vẫn chạy
> bình thường, kho rỗng. Nguồn tạo pack là tuỳ chọn và có thể thay bất cứ lúc nào.

## File OS cần xuất
- Tên: `prompt-pack.json`
- Encoding: UTF-8
- Nội dung: **một JSON array** các entry (mỗi entry = 1 prompt/skill tái dùng, trích/đúc từ 1 repo).

## Schema mỗi entry
```jsonc
{
  "id": "skill_agent-skills_ui-review",      // string, duy nhất, kebab/snake. Bắt buộc.
  "title": "UI review skill",                 // ≤ 100 ký tự. Bắt buộc.
  "content": "You are a senior UI/UX reviewer. Given <X>, do <Y>...",  // PROMPT tái dùng thật. Bắt buộc.
  "category": "Agent Skills / Prompt Ops",    // 1 trong các category của inventory. Bắt buộc.
  "tags": ["ui", "review", "skill"],          // mảng string. Tuỳ chọn.
  "source_repo": "addyosmani/agent-skills",   // owner/name. Tuỳ chọn (provenance).
  "source_url": "https://github.com/addyosmani/agent-skills",  // Tuỳ chọn.
  "tier": "S",                                 // S|A|B|C. Tuỳ chọn (để lọc/ưu tiên).
  "kind": "skill"                              // "prompt" | "skill" | "template" | "system". Tuỳ chọn.
}
```

## Yêu cầu chất lượng `content` (phần quan trọng nhất)
- Là **prompt dùng được ngay** (copy-paste vào ChatGPT/Claude/Gemini là chạy), KHÔNG phải mô tả repo.
- Đúc kết technique/skill/workflow cốt lõi của repo thành 1 prompt tái dùng (system prompt, skill instruction, hoặc template có `{biến}`).
- Ưu tiên repo tier **S/A** và category **Agent Skills / Prompt Ops**, **AI Agent / Agent Harness**, **RAG / Knowledge / Memory** — nơi có prompt/skill giá trị.
- Nếu 1 repo có nhiều skill → tách thành nhiều entry (`id` khác nhau).
- Dùng `{placeholder}` cho phần user cần điền (extension sẽ nhận diện làm variables).

## Giới hạn (để bundle gọn, tránh phình extension)
- Khuyến nghị **≤ 500 entry** cho pack v1 (chọn tinh, không đổ hết 1510 repo).
- `content` mỗi entry nên ≤ ~4000 ký tự.
- Tổng file nên ≤ ~2 MB.

## Bàn giao
Đưa tôi file `prompt-pack.json` → tôi chạy `build-prompt-pack.js` để sinh `src/prompts/BundledPrompts.js` (seeder tự nạp vào kho, flag-versioned, idempotent, không đụng prompt user tự tạo). Rebuild = bump version, thay bộ `_bundled` cũ.
