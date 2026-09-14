import { DECKS } from '@planning-poker/shared';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-widest text-indigo-400">
          HBLab COE — MVP
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Planning Poker</h1>
        <p className="text-lg text-slate-300">
          Ước lượng story point real-time cho buổi refinement của team.
        </p>
      </header>

      <section aria-labelledby="decks-heading" className="space-y-4">
        <h2 id="decks-heading" className="text-xl font-semibold">
          Bộ thẻ điểm
        </h2>
        <div className="flex flex-wrap gap-2" data-testid="fibonacci-deck">
          {DECKS.fibonacci.map((card) => (
            <span
              key={card}
              className="inline-flex h-14 w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-lg font-semibold shadow"
            >
              {card}
            </span>
          ))}
        </div>
      </section>

      <p className="text-sm text-slate-400" data-testid="scaffold-notice">
        Đây là trang placeholder của bước scaffold. Các chức năng tạo phòng, vote và reveal sẽ được
        bổ sung ở các task tiếp theo.
      </p>
    </main>
  );
}
