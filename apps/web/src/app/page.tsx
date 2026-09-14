import Link from 'next/link';
import { AuthStatus } from '@/components/auth-status';
import { JoinByCodeForm } from '@/components/join-by-code-form';

/** PRD §9.1: create a room, or join one you were sent the code for. */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-widest text-indigo-400">
          HBLab COE — MVP
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Planning Poker</h1>
        <p className="text-lg text-slate-300">
          Ước lượng story point real-time cho buổi refinement của team.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <section
          aria-labelledby="create-heading"
          className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5"
        >
          <h2 id="create-heading" className="text-xl font-semibold">
            Tạo phòng mới
          </h2>
          <p className="text-sm text-slate-400">
            Đặt tên phòng, chọn bộ thẻ điểm và nhận link mời để gửi cho team.
          </p>
          <Link
            href="/rooms/new"
            data-testid="home-create-room-link"
            className="inline-block rounded-lg bg-indigo-500 px-4 py-2 font-semibold text-white hover:bg-indigo-400"
          >
            Tạo phòng mới
          </Link>
        </section>

        <section
          aria-labelledby="join-heading"
          className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5"
        >
          <h2 id="join-heading" className="text-xl font-semibold">
            Vào phòng có sẵn
          </h2>
          <p className="text-sm text-slate-400">
            Nhập mã phòng host gửi cho bạn. Không cần tài khoản.
          </p>
          <JoinByCodeForm />
        </section>
      </div>

      <section aria-labelledby="identity-heading" className="space-y-3">
        <h2 id="identity-heading" className="text-xl font-semibold">
          Tài khoản
        </h2>
        <AuthStatus />
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/login"
            data-testid="home-login-link"
            className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-800"
          >
            Đăng nhập / Đăng ký
          </Link>
          <Link
            href="/join"
            data-testid="home-guest-link"
            className="rounded-lg border border-slate-700 px-4 py-2 font-semibold text-slate-100 hover:bg-slate-800"
          >
            Vào phòng với tư cách khách
          </Link>
        </div>
        <p className="text-sm text-slate-400">
          Đăng nhập chỉ để lưu lịch sử phiên — tạo và vào phòng không bắt buộc phải có tài khoản.
        </p>
      </section>
    </main>
  );
}
