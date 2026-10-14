<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- SCV & Incentives page uses per-mode config (scv_mode_config: components, weights, TAT days) and inputs (scv_mode_inputs); a lead belongs to a mode via kob_leads.mode, page defaults to kob_configuration.default_mode — Auto and Manual must never share settings.
