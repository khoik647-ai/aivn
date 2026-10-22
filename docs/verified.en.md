# AIVN self-verification results

This page is the source for every **✓ Verified** and **⚠ Failed AIVN's test** label in Discover. **ⓘ Per developer** labels link directly to the model card or the official documentation, with a verbatim quote.

Conventions:

- Only tests that AIVN has run itself are recorded. Each result comes from a single run on a specific machine, with the exact quantized file listed in the catalog; it is not a guarantee for every machine.
- Test machine: Linux x64, 8-thread Intel Xeon CPU, 15 GB RAM, **no GPU** (llama.cpp running on the CPU). Machines with a GPU are much faster; the times here are only for comparing models with each other.
- A model with no entry here has not been verified by AIVN; its labels (if any) are only the developer's claims.
- Failed tests are recorded too, so that nobody mistakes a developer's claim for a verified result.

<a id="v0143-cong-cu"></a>
## 0.14.3 — Tool calling with small models (text only)

Prompt: “Mở ứng dụng Máy tính” (“Open the Calculator app”), one run per model, with the AIVN AGENT computer/app tools turned on.

| Model | Tool called | Result |
|---|---|---|
| Qwen2.5 0.5B Instruct Q4_K_M | `open_app {"name":"Máy tính"}` | ✓ Opened it and answered correctly |
| Gemma 2 2B Q4_K_M | `open_app {"name":"Calculator"}` (text-based tool protocol) | ✓ Opened it |
| Gemma 3 1B Q4_K_M | `open_app {"name":"Calculator"}` | ✓ Called the right tool, but its reply afterwards went off topic |
| Qwen3 0.6B Q4_K_M | `list_apps {"query":"máy tính"}` | Only listed apps, did not open one — no label |
| Qwen2.5 Coder 7B Q4_K_M | (no call) | ⚠ Refused: “Không có quyền truy cập vào các ứng dụng…” (“I have no access to applications…”) |

<a id="v0143-nhin-anh"></a>
## 0.14.3 — Seeing images, locating buttons, calling tools (vision models)

Three tests per model (Q4_K_M model file, Q8_0 or F16 vision file):

1. **Seeing images:** an image with the word HELLO and a red circle. Question: “What word is it, and what color is the circle?”
2. **Locating UI elements:** a screenshot of a Zalo window. The model is asked for the position of the “blue Send button in the bottom-right corner”. It passes when the center of the returned box lies inside the real Send button.
3. **Calling tools:** “Open Zalo”. It passes when the model calls `open_app {"name":"Zalo"}`.

| Model | Sees images | Locates the Send button | Calls tools |
|---|---|---|---|
| Qwen3-VL 4B | ✓ | ✓ | ✓ |
| Qwen3-VL 8B | ✓ | ✓ | ✓ |
| Qwen3-VL 2B (Q8_0)* | ✓ | — | ✓ (opened Calculator) |
| Qwen2.5-VL 3B | ✓ | ✓ | ✓ |
| Qwen2.5-VL 7B | ✓ | ✓ | ⚠ did not call the tool |
| UI-TARS 1.5 7B | ✓ | ✓ | ⚠ did not call the tool |
| Holo1.5 3B | ✓ | ⚠ wrong answer format; AIVN 0.14.3 could not read the coordinates | ✓ |
| Gemma 3 4B | ✓ | ⚠ wrong position only | ✓ |
| InternVL3 2B | ✓ | ⚠ wrong position only | ✓ |
| InternVL3 8B | ✓ | ⚠ wrong position only | ✓ |

\* The Qwen3-VL 2B **Q4_K_M** build (not in the catalog) only got the position of the Send button wrong, and it could not open Zalo; the catalog ships only the Q8_0 build. For the grounding results of the Q8_0 build, see the 0.16 section below.

<a id="v0153-agent"></a>
## 0.15.3 — AIVN AGENT doing multi-step work

Main model **Qwen3 4B Instruct 2507** (Q4_K_M), machine without a GPU, 8192-token context.

- **Multi-step file task:** read `chi-tieu-thang-9.csv`, work out the total, the average and the biggest spending category, then write `bao-cao-chi-tieu.md` (4 tool steps, correct figures).
- **Deleting files:** when a file could not be moved to the Recycle Bin, AIVN AGENT stopped and asked the user instead of deleting it permanently on its own.
- **Memory:** saved “Sinh viên VLU tên Khôi, thích môn học Trí tuệ nhân tạo.” (“A VLU student named Khôi who likes the Artificial Intelligence course.”) and used it again in a later conversation.
- **Schedules:** created a reminder to drink water, and the reminder ran on time.
- **API server:** returned standard OpenAI `tool_calls` for the `get_weather` tool.
- **Screen control (with Qwen3-VL 2B Q8_0 as the eyes):** the task “Trong cửa sổ Zalo đang mở, tìm liên hệ Trần Quỳnh Anh và mở cuộc trò chuyện với người đó.” (“In the open Zalo window, find the contact Trần Quỳnh Anh and open a chat with them.”) on a simulated Zalo. AIVN AGENT looked at the screen, typed the name into the Search box, typed it again without diacritics when no result appeared, then clicked the right “Tran Quynh Anh” (4 steps, 289 seconds).
- Every answer and report was in Vietnamese.

<a id="v016-dinh-vi"></a>
## 0.16 — Grounding score (AIVN Bench, 10 targets)

A screenshot of the AIVN Bench window with 10 items (buttons, text fields, checkboxes, tabs, list items). The model is asked for the coordinates of each item; it passes when the returned point lies inside that item's bounds. Test machine: Linux, 8 CPU threads, no GPU (run with llama-server). Each model uses the exact prompt and output format published by its developer.

| Model | Grounding score | Time |
|---|---|---|
| UI-TARS-1.5 7B (GUI agent) | 9/10 | 171 seconds |
| Qwen3-VL 8B Instruct | 9/10 | 258 seconds |
| Qwen3-VL 4B Instruct | 8/10 | 106 seconds |
| UI-Venus Ground 7B (GUI grounding) | 8/10 | 419 seconds (Qwen2.5-VL-style point prompt; the developer's `[x1,y1,x2,y2]` box prompt scored only 3/10 because the boxes were off by about 20 pixels, so AIVN uses the point prompt) |
| Qwen3-VL 2B Instruct | 6/10 | 85 seconds |
| Holo1.5 3B (GUI grounding) | 4/10 | 131 seconds |
| Qwen2.5-VL 3B Instruct | 2/10 | 142 seconds |
| Holo1.5 7B (GUI grounding) | 1/10 | 173 seconds (broken JSON output, for example `{"x": 70, 451}`; AIVN has added a JSON constraint and will measure it again) |

AIVN AGENT only accepts models that score at least 6/10 on grounding, can see the screen and call tools reliably (verified in the sections above).

<a id="v016-goi-cong-cu"></a>
## 0.16 beta.2 — Tool calling with real prompts (2B / 4B / 8B)

A re-run after failures on real computers (Zalo, Outlook on the web, volume). Each prompt was run 5 times (temperature 0.7) through llama-server `--jinja` with the full set of AIVN AGENT tool definitions; a run passes when the first call is the right tool with the right arguments.

| Prompt | Qwen3-VL 2B Q8_0 | Qwen3-VL 4B Q4_K_M | Qwen3-VL 8B Q4_K_M |
|---|---|---|---|
| Send a Zalo message to the group `AIVN test`: `AIVN test 1` | 3/5 | 5/5 | 5/5 |
| Compose an email in Outlook on the web, compose only, do not send (first step) | 5/5 | 5/5 | 5/5 |
| Turn the volume up | 5/5 | 5/5 | 5/5 |
| Turn the volume up to 100 (set the level) | 0/5 | 5/5 | 5/5 |
| Outlook step 2: click “New mail” (“Thư mới”) in the element list | 0/5 | 5/5 | 5/5 |
| **Total** | **13/25** | **25/25** | **25/25** |

AIVN AGENT threshold: 23/25. Conclusions:
- Qwen3-VL 2B did not reach the threshold. Main errors: calling `open_app` again instead of clicking a button it had already seen, and calling `volume_up` with a level instead of setting the level (AIVN now turns this into setting the level automatically, but the step 2 error remains).
- Computers with 12 GB of VRAM: the default is the strongest model that runs smoothly and passes this test (Qwen3-VL 8B).
- Computers with a GPU under 6 GB: AIVN AGENT runs with an 8K context and a `q8_0` K/V cache and suggests ⭐ Qwen3-VL 2B, because with these settings 2B fits almost entirely on the GPU. Qwen3-VL 4B (25/25) can still be chosen and is labeled “Runs slowly”. On a real RTX 3050 Ti 4 GB laptop (beta.2.7 and beta.2.8 builds), 4B had 16/37 layers on the GPU at a 16,384 context and only 6/37 layers at a 65,536 context. The low layer count comes from llama.cpp keeping 1 GB of VRAM free and from the memory a large context needs, not only from the model size. The load dialog (Ctrl+L) estimates layers the same way llama.cpp picks them.
- Computers with a GPU of 6 GB or more: AIVN AGENT does not use Qwen3-VL 2B (it can still be used for chat).
