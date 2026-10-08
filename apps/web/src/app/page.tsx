import Link from 'next/link';
import { IdentitySection } from '@/components/identity-section';
import { JoinByCodeForm } from '@/components/join-by-code-form';

/** PRD §9.1: create a room, or join one you were sent the code for. */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-widest text-brand-ink">
          HBLab COE — MVP
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Planning Poker</h1>
        <p className="text-lg text-ink-muted">
          Ước lượng story point real-time cho buổi refinement của team.
        </p>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <section
          aria-labelledby="create-heading"
          className="space-y-3 rounded-xl border border-line bg-surface p-5"
        >
          <h2 id="create-heading" className="text-xl font-semibold">
            Tạo phòng mới
          </h2>
          <p className="text-sm text-ink-muted">
            Đặt tên phòng, chọn bộ thẻ điểm và nhận link mời để gửi cho team.
          </p>
          <Link
            href="/rooms/new"
            data-testid="home-create-room-link"
            className="inline-block rounded-lg bg-brand px-4 py-2 font-semibold text-on-brand hover:bg-brand-strong"
          >
            Tạo phòng mới
          </Link>
        </section>

        <section
          aria-labelledby="join-heading"
          className="space-y-3 rounded-xl border border-line bg-surface p-5"
        >
          <h2 id="join-heading" className="text-xl font-semibold">
            Vào phòng có sẵn
          </h2>
          <p className="text-sm text-ink-muted">
            Nhập mã phòng host gửi cho bạn. Không cần tài khoản.
          </p>
          <JoinByCodeForm />
        </section>
      </div>

      <IdentitySection />
    </main>
  );
}
