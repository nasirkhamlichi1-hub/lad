# CLPD Accreditation — Process Map

Editable source for the accreditation flow (renders on GitHub). The matching
image is `accreditation-process-map.svg`.

```mermaid
flowchart TD
    A["Provider or firm submits an application<br/><i>materials · learning objectives · audience · attachments</i>"]
    B["Enters the LAD review queue — PENDING<br/><i>classified as Course/Activity or Provider/Entity</i>"]
    C["Two LAD reviewers assigned — R1 & R2<br/><i>intelligence + super tier · plus Lex AI as a 3rd reviewer</i>"]
    D{"Each reviewer scores the rubric<br/>(pass ≥ 70% per section)"}
    D1["COURSE / ACTIVITY<br/>Activity Review · 5×0-4<br/>+ Trainer Review · 4×0-5"]
    D2["PROVIDER / ENTITY<br/>Entity Review · 8 criteria · max 20"]
    E{"Both reviews ≥ 70%<br/>in every section?"}
    F["Approved — accreditation code issued"]
    G["Course published to the catalogue — bookable"]
    H["Lawyers book & attend sessions"]
    I["Attendance filed → CPD points awarded"]
    R["Request changes → revise & resubmit"]
    J["Reject"]
    K["Defer to DG"]

    A --> B --> C --> D
    D -->|course| D1 --> E
    D -->|provider| D2 --> E
    E -->|YES| F --> G --> H --> I
    E -->|NO| R
    E -->|NO| J
    E -->|NO| K
    R -.resubmit.-> A
```

## Stages
1. **Submit** — a provider or firm submits an application (course materials, learning objectives, audience, attachments). Two kinds: a **Course/Activity** or a **Provider/Entity** registration.
2. **Review** — it enters the LAD queue as PENDING, gets **two reviewers (R1 & R2)** from the intelligence + super tier, and **Lex AI** adds a third-reviewer rationale. Each scores the rubric for the application type:
   - *Course/Activity* → **Activity Review** (5 criteria × 0–4) **+ Trainer Review** (4 criteria × 0–5).
   - *Provider/Entity* → **Entity Review** (8 criteria, max 20).
   - **Pass rule: both reviews must reach ≥ 70% in every section.**
3. **Decision** — if both pass → **Approve**; otherwise **Request changes** (back to the provider to resubmit), **Reject**, or **Defer to DG**.
4. **Go-live** — on approval an accreditation **code** is issued, the course is **published to the catalogue** (bookable), lawyers **book & attend**, and filed **attendance awards CPD points**.
</content>
