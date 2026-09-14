# PRD: Planning Poker App

**Phiên bản:** 1.0 (MVP)
**Ngày:** 2026-09-14
**Người yêu cầu:** khoipv — Hblab_COE
**Mục đích tài liệu:** Đặc tả sản phẩm để đưa vào Claude Code triển khai trực tiếp.

---

## 1. Tổng quan

Planning Poker là công cụ giúp team (thường là team phát triển phần mềm) ước lượng story point cho các task/story trong buổi refinement/sprint planning, theo mô hình mỗi thành viên chọn một thẻ điểm số kín, sau đó tất cả cùng lộ (reveal) kết quả một lúc để tránh hiệu ứng đám đông (anchoring bias).

Sản phẩm là một **web app real-time**: người tham gia join vào một phòng qua link, vote đồng thời, và thấy kết quả cập nhật trực tiếp không cần refresh trang.

Theo yêu cầu, hệ thống hỗ trợ **cả hai kiểu người dùng**: khách vãng lai join bằng link không cần đăng nhập (cho các buổi họp nhanh, tạm thời), và người dùng có tài khoản để phiên làm việc được lưu lại thành lịch sử.

## 2. Đối tượng sử dụng & use case chính

- Scrum Master / Team Lead: tạo phòng, chọn bộ thẻ điểm, điều phối buổi estimate, bấm reveal.
- Thành viên team (dev, QA, BA...): join phòng qua link, chọn thẻ để vote cho từng task.
- Người dùng có tài khoản: ngoài vai trò trên, có thể xem lại lịch sử các phiên đã tham gia/tạo.

Use case chính: "Là Scrum Master, tôi tạo một phòng, gửi link cho team, cả team vote điểm cho từng story, hệ thống hiện kết quả và tôi ghi nhận điểm cuối cùng."

## 3. Phạm vi MVP

### 3.1. Trong phạm vi (In scope)

1. Tạo phòng: đặt tên phòng, chọn bộ thẻ điểm (deck) — Fibonacci (0, 1, 2, 3, 5, 8, 13, 21, ?, ☕) hoặc T-shirt size (XS, S, M, L, XL, ?).
2. Join phòng qua link/mã phòng:
   - Khách (guest): chỉ cần nhập tên hiển thị, không cần tài khoản.
   - Người dùng đã đăng nhập: tự động dùng tên tài khoản, có thể đổi tên hiển thị cho phòng đó.
3. Đăng ký/đăng nhập tài khoản (email + mật khẩu hoặc magic link, **và đăng nhập social qua Google**) — không bắt buộc để dùng app.
4. Trong phòng: danh sách người tham gia real-time, trạng thái mỗi người (đã vote / chưa vote — không lộ giá trị).
5. Vote: mỗi người chọn 1 thẻ trong bộ thẻ của phòng; có thể đổi vote trước khi reveal.
6. Reveal: host bấm "Lộ bài" để hiện toàn bộ giá trị vote của mọi người cùng lúc.
7. Kết quả sau reveal: liệt kê vote từng người, tính trung bình và median (nếu deck là số), cảnh báo/đồng thuận nếu tất cả trùng giá trị.
8. Vote lại (New round / Revote): reset vote để làm lại cho cùng một mục hoặc chuyển sang mục tiếp theo.
9. Rời phòng; phòng tự động dọn sau một khoảng thời gian không hoạt động (ví dụ 24h).
10. Lịch sử phiên (chỉ cho user đã đăng nhập): danh sách các phòng đã tạo/tham gia, kèm kết quả từng round đã reveal, xem lại được sau này.

### 3.2. Ngoài phạm vi MVP (Out of scope — để phase sau)

- Tích hợp Jira/Trello/Azure DevOps để import danh sách story tự động.
- Quản lý danh sách nhiều task/backlog trong 1 phòng với thứ tự, mô tả chi tiết.
- Timer đếm ngược cho mỗi round.
- Chat trong phòng.
- Bộ thẻ tùy chỉnh (custom deck) do người dùng tự định nghĩa.
- Thống kê/analytics nâng cao theo team (velocity trend, biểu đồ theo thời gian).
- Bảo vệ phòng bằng mật khẩu, phân quyền nhiều host.
- Export kết quả ra file (CSV/Excel).
- Ứng dụng mobile riêng (native app).

## 4. User flow chính

1. Người dùng vào trang chủ → chọn "Tạo phòng mới".
2. Nhập tên phòng, chọn bộ thẻ điểm → hệ thống tạo phòng và link mời, chuyển vào phòng với vai trò host.
3. Host copy link gửi cho team qua Slack/Teams.
4. Thành viên mở link → nếu chưa đăng nhập, nhập tên hiển thị → vào phòng.
5. Mọi người thấy danh sách thành viên trong phòng, mỗi người chọn 1 thẻ điểm cho task đang thảo luận (thảo luận diễn ra ngoài app, ví dụ trên call).
6. Khi đủ người vote (hoặc host chủ động), host bấm "Lộ bài" → tất cả giá trị hiện ra cùng lúc, kèm trung bình/median.
7. Nếu chưa đồng thuận, host bấm "Vote lại" để làm round mới cho cùng task.
8. Nếu đồng thuận, host bấm "Task tiếp theo / Round mới" để chuyển sang ước lượng mục kế tiếp.
9. Kết thúc buổi, host hoặc thành viên rời phòng. Nếu đã đăng nhập, phiên này lưu vào lịch sử để xem lại sau.

## 5. Yêu cầu chức năng chi tiết (Functional Requirements)

| ID | Chức năng | Mô tả |
|----|-----------|-------|
| FR-1 | Tạo phòng | User (guest hoặc đã login) tạo phòng mới, chọn deck, nhận được room code/link duy nhất. |
| FR-2 | Join phòng | User vào phòng qua link/code, nhập tên hiển thị nếu là guest. |
| FR-3 | Danh sách người tham gia real-time | Mọi client trong phòng thấy danh sách cập nhật ngay khi có người vào/ra/đổi trạng thái vote. |
| FR-4 | Vote | User chọn 1 thẻ trong deck của phòng; giá trị được giữ kín với người khác cho tới khi reveal; user có thể đổi vote trước khi reveal. |
| FR-5 | Reveal | Host (người tạo phòng hoặc người được gán quyền) bấm để lộ toàn bộ vote cùng lúc cho mọi client. |
| FR-6 | Tổng hợp kết quả | Sau reveal: hiển thị bảng vote theo tên, tính trung bình/median (deck số), đánh dấu đồng thuận khi tất cả giống nhau. |
| FR-7 | Round mới / Vote lại | Reset trạng thái vote của tất cả thành viên trong phòng để bắt đầu round tiếp theo. |
| FR-8 | Đăng ký/đăng nhập | Tài khoản qua email, hoặc social login (Google — mặc định cho MVP), dùng để lưu lịch sử; không bắt buộc để tạo/join phòng. |
| FR-9 | Lịch sử phiên | User đã đăng nhập xem được danh sách phòng mình từng tạo/tham gia và kết quả các round đã reveal. |
| FR-10 | Rời phòng & dọn phòng tự động | User rời phòng chủ động; phòng không hoạt động quá 24h tự động đóng/xóa dữ liệu tạm. |

## 6. Kiến trúc kỹ thuật đề xuất

> Đây là đề xuất mặc định để Claude Code có điểm khởi đầu — nên xác nhận lại trước khi code nếu team đã có stack quen dùng khác.

- **Frontend:** Next.js (React) + TypeScript + Tailwind CSS. Deploy trên Vercel.
- **Backend & Realtime & DB:** Supabase — dùng Postgres cho dữ liệu (phòng, người tham gia, vote, lịch sử), Supabase Auth cho đăng nhập (email/password, magic link, và OAuth social login), Supabase Realtime (Postgres changes hoặc Broadcast/Presence channel) để đồng bộ trạng thái phòng giữa các client theo thời gian thực.
  - Lý do chọn Supabase: gộp được cả 3 nhu cầu (DB, Auth, Realtime) trong một dịch vụ, giảm việc phải tự dựng WebSocket server riêng, phù hợp để build nhanh MVP.
  - Phương án thay thế nếu không muốn phụ thuộc Supabase: Node.js + Socket.io cho realtime, PostgreSQL/MySQL riêng cho dữ liệu, NextAuth cho đăng nhập (NextAuth cũng hỗ trợ social login sẵn). Phức tạp hơn nhưng chủ động hạ tầng hơn.
- **Social login:** dùng Supabase Auth OAuth provider — mặc định bật **Google** (phổ biến nhất, dễ đăng ký OAuth app). Supabase hỗ trợ sẵn nhiều provider khác (GitHub, Microsoft, Facebook...) nên thêm sau khá nhẹ, chỉ cần cấu hình thêm provider trong Supabase dashboard, không đổi kiến trúc.
- **Guest session:** dùng Supabase Anonymous Auth (hoặc đơn giản là lưu tên hiển thị + một `participant_id` random trong localStorage/cookie) để guest có định danh tạm thời trong phòng mà không cần tài khoản thật.

## 7. Data model (đề xuất)

| Bảng | Trường chính | Ghi chú |
|------|--------------|---------|
| `users` | id, email, display_name, created_at | Do Supabase Auth quản lý phần lớn. |
| `rooms` | id, code (unique, dùng cho link), name, deck_type, host_id (nullable nếu host là guest), created_at, last_active_at | `deck_type`: `fibonacci` \| `tshirt`. |
| `room_participants` | id, room_id, user_id (nullable), guest_name, joined_at, is_online | `user_id` null khi là guest. |
| `voting_rounds` | id, room_id, round_number, status (`voting` \| `revealed`), created_at, revealed_at | Mỗi lần "Round mới" tạo 1 record. |
| `votes` | id, round_id, participant_id, value, voted_at | Giá trị chỉ trả về client sau khi round `revealed`. |

## 8. Real-time events / kênh đồng bộ (đề xuất)

| Sự kiện | Khi nào bắn | Payload chính |
|---------|-------------|----------------|
| `participant:joined` | Có người vào phòng | participant info |
| `participant:left` | Có người rời phòng | participant_id |
| `vote:cast` | Một người vote (chưa lộ giá trị) | participant_id, has_voted = true |
| `round:revealed` | Host bấm reveal | toàn bộ votes của round, avg, median |
| `round:reset` | Host bấm round mới/vote lại | round_id mới, status = voting |

## 9. Danh sách màn hình (UI)

1. **Trang chủ:** nút "Tạo phòng mới", ô nhập mã phòng để join, tùy chọn đăng nhập/đăng ký.
2. **Tạo phòng:** nhập tên phòng, chọn bộ thẻ điểm.
3. **Join phòng:** nhập tên hiển thị (nếu là guest).
4. **Phòng chính:** danh sách thành viên (kèm trạng thái đã vote), bộ thẻ để chọn, nút "Lộ bài" (chỉ host thấy), khu vực kết quả sau reveal, nút "Round mới".
5. **Đăng nhập/Đăng ký:** form email + mật khẩu, magic link, hoặc nút "Đăng nhập với Google".
6. **Lịch sử phiên:** danh sách phòng đã tham gia (chỉ hiện khi đã đăng nhập), click vào xem lại kết quả từng round.

## 10. Yêu cầu phi chức năng (Non-functional Requirements)

- Độ trễ đồng bộ real-time giữa các client dưới 1 giây trong điều kiện mạng bình thường.
- Hỗ trợ tối thiểu 20 người tham gia đồng thời trong 1 phòng.
- Responsive, dùng tốt trên trình duyệt mobile (không cần cài app).
- Không yêu cầu cài đặt gì phía người dùng — chỉ cần trình duyệt và link.
- Dữ liệu guest (không tài khoản) không cần lưu vĩnh viễn, có thể dọn sau khi phòng hết hạn.
- Bảo mật cơ bản: room code đủ khó đoán (không phải số thứ tự tăng dần) để tránh người lạ đoán link vào phòng.

## 11. Success metrics (gợi ý)

- Thời gian trung bình từ lúc tạo phòng đến khi thành viên đầu tiên join.
- Tỷ lệ phiên hoàn thành ít nhất 1 round reveal (đo mức độ app thực sự được dùng để estimate, không chỉ tạo phòng rồi bỏ).
- Số lượng phòng active / tuần, số user quay lại dùng lịch sử.

## 12. Rủi ro & câu hỏi mở cần xác nhận trước khi code

- Xác nhận chọn Supabase hay tự dựng backend riêng (ảnh hưởng lớn đến tốc độ build và chi phí vận hành).
- Ai được quyền bấm "Lộ bài" — chỉ host, hay bất kỳ ai trong phòng?
- Có cần giới hạn số phòng/số người tạo bởi 1 guest để tránh spam không?
- Xử lý khi mất kết nối giữa chừng (rớt mạng) — có tự động reconnect và giữ nguyên vote đã chọn không?
- Social login chỉ cần Google, hay cần thêm Microsoft/GitHub (ví dụ nếu công ty dùng email @hblab.vn qua Google Workspace hoặc Microsoft 365)?

## 13. Roadmap sau MVP (tham khảo)

- Tích hợp Jira/Trello để import danh sách story cần estimate.
- Quản lý nhiều task trong 1 phòng, có thứ tự và chuyển tự động.
- Timer, custom deck, chat trong phòng.
- Thống kê velocity theo team, export kết quả.
- Bảo vệ phòng bằng mật khẩu / giới hạn domain email được join.
