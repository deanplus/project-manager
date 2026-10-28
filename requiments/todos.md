# Independent Todos and dashboard completion

- New status next steps create independent Todos atomically, linked to the source entry UUID and its project.
- Existing next-step text remains immutable and is converted explicitly, once per source array index.
- Todos can also be created without a project or source, and assigned a project later.
- The dashboard provides global and project-filtered Todo views, source links, and completion controls for Todos and activities.
- Completing an activity does not complete its Todos or declare the entire project complete. Append a follow-up retaining the current project status and link it through the existing completion mechanism.
- Todo creation and completion must survive export/import. Legacy imports must not generate new work.
- Mutating HTTP routes require JSON and same-origin browser requests, with bounded input and visible errors.
- No commit or deployment is included.
