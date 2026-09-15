"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Dashboard() {
  const router = useRouter();
  const [isModalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="border-b border-black/[.08] bg-white px-8 py-4 dark:border-white/[.1] dark:bg-black">
        <span className="text-lg font-semibold tracking-tight">Demo Tutorial</span>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-8 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dự án của bạn</h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Quản lý và khởi tạo các dự án mới cho nhóm.
            </p>
          </div>
          <button
            type="button"
            data-tutorial="new-project-btn"
            onClick={() => setModalOpen(true)}
            className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            + Tạo dự án mới
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {["Website công ty", "Ứng dụng di động", "Hệ thống nội bộ"].map((name) => (
            <div
              key={name}
              className="rounded-xl border border-black/[.08] bg-white p-5 dark:border-white/[.1] dark:bg-zinc-900"
            >
              <div className="mb-3 h-8 w-8 rounded-lg bg-zinc-200 dark:bg-zinc-700" />
              <h2 className="text-sm font-medium">{name}</h2>
              <p className="mt-1 text-xs text-zinc-500">Cập nhật 2 ngày trước</p>
            </div>
          ))}
        </div>
      </main>

      {isModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div
            data-tutorial="modal"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900"
          >
            <h3 className="text-lg font-semibold">Tạo dự án mới</h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Bạn sẽ được chuyển sang bước thiết lập thông tin dự án ở trang tiếp
              theo.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Huỷ
              </button>
              <button
                type="button"
                data-tutorial="modal-continue-btn"
                onClick={() => router.push("/onboarding")}
                className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background hover:bg-[#383838] dark:hover:bg-[#ccc]"
              >
                Tiếp tục thiết lập
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
