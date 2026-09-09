import { createRoomAction } from "./actions";

export default async function NewRoomPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-lg p-6">
      <h1 className="mb-4 text-2xl font-semibold">Create a room</h1>
      <form action={createRoomAction} className="space-y-4 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <label className="block text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">Name</span>
          <input name="name" required maxLength={80} className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />
        </label>
        <fieldset className="text-sm">
          <legend className="text-zinc-600 dark:text-zinc-400">Type</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
              <input type="radio" name="type" value="world" defaultChecked />
              <span>
                <span className="font-medium">2D world</span>
                <br />
                <span className="text-xs text-zinc-500">Top-down world people grow with prompts.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
              <input type="radio" name="type" value="art" />
              <span>
                <span className="font-medium">Art prompt wall</span>
                <br />
                <span className="text-xs text-zinc-500">Shared image canvas driven by queued prompts.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
              <input type="radio" name="type" value="kanban" />
              <span>
                <span className="font-medium">Kanban board</span>
                <br />
                <span className="text-xs text-zinc-500">Cards with lock-while-editing. No AI cost.</span>
              </span>
            </label>
          </div>
        </fieldset>
        <label className="block text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">World prompt (worlds only)</span>
          <input name="world_prompt" maxLength={200} placeholder="a rainy neon city by the harbour" className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" />
          <span className="text-xs text-zinc-500">Generates the base map. Everyone else adds to it with prompts.</span>
        </label>
        <fieldset className="text-sm">
          <legend className="text-zinc-600 dark:text-zinc-400">Visibility</legend>
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" name="visibility" value="private" defaultChecked /> Private (invite only)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="visibility" value="public" /> Public
            </label>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Private rooms bill at pay-per-use rates; free credits only work in public rooms.
          </p>
        </fieldset>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-black">
          Create
        </button>
      </form>
    </main>
  );
}
