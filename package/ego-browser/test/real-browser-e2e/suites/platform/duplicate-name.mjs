export const duplicateTaskSpaceNameCase = {
  name: "TaskSpace duplicate-name rejection",
  kind: "platform",
  rounds: [
    () => `
      const task = await egoBrowser.newTaskSpace(
        taskName + " duplicate-name guard",
      );
      await writeFile(
        join(tempDir, "duplicate-name-taskspace.json"),
        JSON.stringify({ id: task.id, name: task.name }),
      );
      const completed = await egoBrowser.completeTaskSpace(task.id);
      assertEqual(
        completed.done,
        true,
        "the first round preserves the TaskSpace for the user",
      );
    `,
    () => `
      const saved = JSON.parse(
        await readFile(
          join(tempDir, "duplicate-name-taskspace.json"),
          "utf8",
        ),
      );
      let duplicateError;
      try {
        await egoBrowser.newTaskSpace(saved.name);
      } catch (error) {
        duplicateError = error;
      }
      assert(duplicateError, "a duplicate TaskSpace name is rejected");
      assertIncludes(
        duplicateError.message,
        "TaskSpace " + saved.id + " already uses this name",
        "the duplicate error identifies the existing TaskSpace",
      );
      assertIncludes(
        duplicateError.message,
        "user-owned",
        "the duplicate error reports current ownership",
      );

      const matches = (await egoBrowser.listTaskSpace()).filter(
        (space) => space.name === saved.name,
      );
      assertEqual(
        matches.length,
        1,
        "duplicate rejection leaves exactly one TaskSpace",
      );
      assertEqual(
        matches[0].id,
        saved.id,
        "duplicate rejection preserves the original TaskSpace id",
      );

      const closed = await egoBrowser.closeTaskSpace(saved.id);
      assertEqual(closed.done, true, "the duplicate-name fixture is cleaned up");
    `,
  ],
};
