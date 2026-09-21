import Link from 'next/link';
import { JoinByCodeForm } from '@/components/join-by-code-form';
import { SignInPrompt } from '@/components/sign-in-prompt';

/**
 * PRD §9.3, step one: which room? The display name is asked for on `/join/[code]`, once we know
 * the room exists — there is no point naming yourself for a room that is not there.
 */
export default function JoinPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Vào phòng</h1>
        <p className="text-sm text-slate-400">
          Nhập mã phòng host đã gửi cho bạn. Không cần tài khoản — chỉ cần một cái tên để mọi người
          trong phòng nhận ra bạn.
        </p>
      </header>

      <JoinByCodeForm />

      <p className="text-sm text-slate-400">
        Chưa có phòng nào?{' '}
        <Link href="/rooms/new" className="font-medium text-indigo-400 hover:underline">
          Tạo phòng mới
        </Link>
      </p>
      <SignInPrompt />
    </main>
  );
}
