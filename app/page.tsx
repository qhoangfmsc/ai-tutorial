export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="border-b border-black/[.08] bg-white px-8 py-4 dark:border-white/[.1] dark:bg-black">
        <span className="text-lg font-semibold tracking-tight">Demo Tutorial</span>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-8 py-24 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">
          Quản lý dự án gọn gàng hơn
        </h1>
        <p className="mt-4 max-w-lg text-base text-zinc-600 dark:text-zinc-400">
          Demo Tutorial giúp đội nhóm của bạn khởi tạo và theo dõi dự án chỉ
          trong vài bước. Truy cập trang quản lý để bắt đầu.
        </p>
      </main>
    </div>
  );
}
