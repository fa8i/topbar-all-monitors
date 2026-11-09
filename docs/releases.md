# Branches and releases

## Branch policy

- `main` contains the current implementation and the compatibility index in
  `README.md`. It currently supports GNOME Shell 50 and 51 on Wayland.
- Keep GNOME versions together while they share a maintainable implementation.
- Before an incompatible port drops support for older versions, create a
  maintenance branch from the last compatible commit. Name it for that family,
  for example `gnome-50-51`, then continue the newer implementation on `main`.
- Add each maintenance branch to the README table with its Shell versions,
  installable release ZIP and maintenance status.
- Backport relevant fixes to maintained branches and verify them on the Shell
  versions those branches claim to support. Do not expand `shell-version` without
  auditing and testing the target version.
- Use temporary feature branches for unfinished changes. Do not leave `main`
  pointing to obsolete code while the supported implementation lives elsewhere.

The former `gnome-50-support` and `gnome-51-support` branches differed only in
`shell-version`. Their shared fixes and GNOME 50/51 support are consolidated
in `main`. Existing release tags remain unchanged.

## GNOME Extensions distribution

Keep one extension listing and the existing UUID:
`topbar-all-monitors@fa8i.github.io`.

Upload one package for each implementation being released. A shared 50/51
implementation declares `"shell-version": ["50", "51"]` and needs one ZIP.
An incompatible future implementation declares only its tested versions and
is submitted separately to the same listing. Older compatible packages can
remain available for their respective Shell versions. Updating a Git branch
or tag does not update the package hosted by GNOME Extensions.

Leave `version` and `version-name` out of source metadata. GNOME Extensions
assigns its integer submission number; omitting `version-name` keeps that
number visible. Git tags identify repository releases independently of those
submission numbers.

Official references:

- [Metadata and version numbering](https://gjs.guide/extensions/overview/anatomy.html)
- [Multiple packages for incompatible Shell versions](https://gjs.guide/extensions/upgrading/gnome-shell-45.html#metadata)

## Release procedure

1. Select the correct source branch, verify its supported Shell versions and
   complete the appropriate checks.
2. Commit the release changes and create an immutable Git tag for that commit.
   Never move an existing published tag to point to different code.
3. Build the installable ZIP from that exact revision with
   `./scripts/package.sh`. Inspect its metadata and contents. The automatic
   GitHub source ZIP is not the extension installation ZIP.
4. Publish a GitHub release for the tag and attach the generated installation
   ZIP. Include Shell compatibility in the release notes.
5. Submit that same ZIP to the existing GNOME Extensions listing. Record the
   assigned submission number and review URL below. Distinguish submitted,
   approved and active packages in release notes.
6. Update the README compatibility table when branches or supported versions
   change. Website activation or another upload is not required for a README
   or branch organization change alone.

## Submission history

| Git revision | GNOME submission | Shell versions | Notes |
| --- | --- | --- | --- |
| [`v0.2.5`](https://github.com/fa8i/topbar-all-monitors/tree/v0.2.5) | [6](https://extensions.gnome.org/review/75595) | 50 | Previous implementation. |
| [`v0.2.6`](https://github.com/fa8i/topbar-all-monitors/tree/v0.2.6) | [7](https://extensions.gnome.org/review/77976) | 50, 51 | Uploaded with `version-name: "0.2.6"`, so the website displays `0.2.6 (7)`. The tag preserves that exact source. |

The later metadata correction removes `version-name` from `main`. It does not
rename submission 7. On 2026-11-06 the reviewer confirmed that changing an
uploaded package requires another upload. If the corrected package is submitted,
record the number actually assigned by the website rather than assuming it can
replace submission 7. Review status must be checked on the linked review page.
