"use client";

import { useState, type FormEvent } from "react";

const PROJECT_TYPES = [
  { id: "website", label: "Website", desc: "Trang giới thiệu hoặc thương mại điện tử" },
  { id: "mobile", label: "Ứng dụng di động", desc: "iOS, Android hoặc đa nền tảng" },
  { id: "internal", label: "Hệ thống nội bộ", desc: "Công cụ quản lý cho nhóm" },
];

const TEAM_OPTIONS = ["Thiết kế", "Kỹ thuật", "Marketing", "Vận hành", "Kinh doanh"];

export default function Onboarding() {
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [projectType, setProjectType] = useState("website");
  const [team, setTeam] = useState<string[]>([]);
  const [agreed, setAgreed] = useState(false);

  function toggleTeam(option: string) {
    setTeam((prev) =>
      prev.includes(option) ? prev.filter((t) => t !== option) : [...prev, option],
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="border-b border-black/[.08] bg-white px-8 py-4 dark:border-white/[.1] dark:bg-black">
        <span className="text-lg font-semibold tracking-tight">Demo Tutorial</span>
      </header>

      <main className="mx-auto w-full max-w-lg flex-1 px-8 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Thiết lập thông tin dự án</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Điền các thông tin bên dưới để hoàn tất khởi tạo dự án.
        </p>

        {submitted ? (
          <div
            data-tutorial="success-banner"
            className="mt-8 rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
          >
            Đã tạo dự án thành công cho <strong>{name || "bạn"}</strong>!
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Tên dự án</span>
              <input
                data-tutorial="input-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ví dụ: Website công ty"
                className="rounded-lg border border-black/[.1] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-zinc-400 dark:border-white/[.15] dark:bg-zinc-900"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Email liên hệ</span>
              <input
                data-tutorial="input-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ban@congty.com"
                className="rounded-lg border border-black/[.1] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-zinc-400 dark:border-white/[.15] dark:bg-zinc-900"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Ghi chú</span>
              <textarea
                data-tutorial="input-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Mô tả ngắn về dự án..."
                className="resize-none rounded-lg border border-black/[.1] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-zinc-400 dark:border-white/[.15] dark:bg-zinc-900"
              />
            </label>

            <div className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Loại dự án</span>
              {PROJECT_TYPES.map((type) => (
                <label
                  key={type.id}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3.5 py-2.5 ${
                    projectType === type.id
                      ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
                      : "border-black/[.1] bg-white dark:border-white/[.15] dark:bg-zinc-900/40"
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <input
                      type="radio"
                      name="projectType"
                      checked={projectType === type.id}
                      onChange={() => setProjectType(type.id)}
                    />
                    {type.label}
                  </span>
                  <span className="pl-5 text-xs text-zinc-500">{type.desc}</span>
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Ngân sách dự kiến</span>
                <input
                  placeholder="Ví dụ: 50.000.000đ"
                  className="rounded-lg border border-black/[.1] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-zinc-400 dark:border-white/[.15] dark:bg-zinc-900"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Thời hạn hoàn thành</span>
                <input
                  type="date"
                  className="rounded-lg border border-black/[.1] bg-white px-3.5 py-2.5 text-sm outline-none focus:border-zinc-400 dark:border-white/[.15] dark:bg-zinc-900"
                />
              </label>
            </div>

            <div className="flex flex-col gap-2 text-sm">
              <span className="font-medium">Đội nhóm tham gia</span>
              <div className="flex flex-wrap gap-2">
                {TEAM_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    onClick={() => toggleTeam(option)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium ${
                      team.includes(option)
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
                        : "border-black/[.1] bg-white text-zinc-600 dark:border-white/[.15] dark:bg-zinc-900 dark:text-zinc-300"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-black/[.1] bg-white p-4 text-xs leading-relaxed text-zinc-500 dark:border-white/[.15] dark:bg-zinc-900 dark:text-zinc-400">
              Bằng việc tạo dự án, bạn đồng ý rằng thông tin cung cấp là chính xác và cho phép Demo
              Tutorial lưu trữ dữ liệu này để phục vụ việc quản lý dự án. Dữ liệu có thể được chia
              sẻ nội bộ với các thành viên bạn chọn ở trên. Bạn có thể chỉnh sửa hoặc xoá dự án bất
              kỳ lúc nào trong phần cài đặt.
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              Tôi đồng ý với điều khoản sử dụng
            </label>

            <button
              type="submit"
              data-tutorial="submit-btn"
              className="mt-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              Hoàn tất
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
