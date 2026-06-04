# Counter Social License (CSL)
### Version 1.0 — June 4th, 2026

---

## Preamble

Software that touches people's lives, their connections, and their data carries a responsibility that ordinary open source licenses were not designed to address. The Counter Social License exists because the values a platform is built on must be enforceable — not merely stated.

This license is designed to ensure that Counter, and any software derived from it, cannot be weaponized against the people it serves. It cannot be turned into a surveillance product. It cannot be sold to the highest bidder. It cannot extract profit from people's privacy. It cannot lock people out of features they deserve. It cannot be quietly closed.

The rights granted here are real and broad. The restrictions are few but absolute. Anyone who shares these values is welcome to build with this software. Anyone who does not is not.

---

## Definitions

**"The Software"** means the Counter platform source code, including all components: server, API, web client, database schema, algorithm, tooling, and any part thereof.

**"Derivative Work"** means any software that incorporates, modifies, extends, or is substantially based upon the Software.

**"You"** means any individual, organization, company, or entity exercising rights under this License.

**"Users"** means any human beings who interact with the Software or a Derivative Work, whether authenticated or not.

**"Individual Tracking"** means the collection, storage, or processing of data in a way that identifies, profiles, or follows a specific person across sessions, time, or contexts — including but not limited to: persistent identifiers, device fingerprints, behavioral event streams, IP address logging tied to identity, cross-session analytics, and advertising profiles.

**"Profit Extraction"** means operating the Software or a Derivative Work in a manner primarily designed to generate revenue from Users' data, attention, or behavior — including but not limited to: selling user data, licensing behavioral profiles, operating a surveillance advertising system, or charging for features that restrict access based on follower count, account age, or payment tier.

**"Network Use"** means deploying the Software or a Derivative Work to serve Users over a network, including the public internet.

**"The Community"** means the collective body of Users, contributors, and stakeholders of a given deployment of the Software.

---

## Part I — Grant of Rights

Subject to the conditions and restrictions in this License, the copyright holder grants You a worldwide, royalty-free, non-exclusive, perpetual license to:

1. **Use** the Software for any purpose consistent with this License.
2. **Study** the Software — read, analyze, and understand how it works.
3. **Modify** the Software — make changes, improvements, or adaptations.
4. **Distribute** the Software — share verbatim copies with others.
5. **Distribute Derivative Works** — share your modifications with others, under this License.
6. **Deploy** the Software or Derivative Works to serve Users over a network.

These rights are granted unconditionally to anyone who complies with this License in full. Partial compliance is not compliance.

---

## Part II — Conditions

The rights in Part I are granted only if You comply with all of the following:

### 1. Source Availability

If You deploy the Software or any Derivative Work to serve Users over a network, You must make the complete corresponding source code available, at no cost, under this License. This includes:

- The full server-side codebase
- The ranking and feed algorithm
- The moderation and content tooling
- The analytics pipeline
- The client applications
- The deployment configuration

There is no partial compliance. There is no "core open, extras closed." Everything that runs must be readable. If it serves Users, its source is accessible to those Users.

**Public deployments** — any deployment accessible to the general public or an open registration base — must make source code publicly available to anyone, without authentication.

**Private deployments** — deployments serving a defined, closed group of Users (such as an organization's internal community) — must make source code available to every User of that deployment, on request and without friction, but are not required to make it publicly available beyond that group. A private deployment becomes a public deployment the moment open registration or public access is introduced, at which point full public source availability is immediately required.

In both cases: if it runs, it is readable by the people it serves. No exceptions.

### 2. License Preservation

All copies and Derivative Works must:

- Retain this License in full, unmodified
- Retain all copyright notices
- Clearly state any modifications made to the Software
- Include a prominent notice that the work is licensed under the Counter Social License v1.0

You may not sublicense the Software under any other license. You may not add restrictions beyond those in this License. You may not remove restrictions from this License.

### 3. Algorithm Transparency

If You deploy the Software or a Derivative Work with any content ranking, feed ordering, or content distribution system, You must:

- Publish the complete algorithm as part of the source code requirement in Condition 1
- Maintain a public, human-readable changelog of every meaningful change to ranking logic, including: what changed, why it changed, and what effect was observed
- Provide Users with a mechanism to understand why specific content was or was not shown to them

You may not operate hidden penalties, invisible reach suppression, shadowbanning, or any undisclosed modification of content distribution. If the system affects what a User sees, that effect must be explainable and the explanation must be accessible.

### 4. Data Minimization and Transparency

You must publish and maintain a complete, accurate, and current description of every category of data collected from Users. This description must:

- List every data point collected
- State the purpose of each data point
- State the retention period of each data point
- Be publicly accessible without authentication
- Be updated within 7 days of any change to data collection practices

If it is not documented, it may not be collected.

### 5. Built with Counter Attribution

Every deployment of the Software or a Derivative Work — public or private — must display a visible "Built with Counter" attribution in the user interface. This is not optional. This is the transparency indicator: it tells every User what they are using, where the code comes from, and that they can hold it to the standards of this License.

The attribution must:

- Be visible to all Users without authentication
- Link to `https://counter.ltd` or the canonical source repository
- Not be hidden, obfuscated, styled to be invisible, or placed where Users would not reasonably encounter it
- Remain present regardless of theming, white-labeling, or UI customization

The attribution may be styled to fit the visual design of the deployment. It may not be removed. A User should never have to wonder what software is serving them — "Built with Counter" is the answer, always present, always honest.

### 6. Deletion on Request

You must provide Users with a mechanism to permanently and completely delete their account and all associated personal data. Upon deletion:

- All personal data must be removed within 30 days
- Aggregate and anonymized data derived from their activity may be retained only if it cannot be reverse-engineered to identify them
- You must confirm deletion to the User in writing

---

## Part III — Restrictions

The following are absolute restrictions. They apply regardless of any other agreement, regardless of circumstance, and cannot be waived.

### 1. No Individual Tracking

You must not engage in Individual Tracking as defined in this License. Specifically, You must not:

- Collect or store IP addresses tied to user identity or content
- Build or maintain behavioral profiles on individual Users
- Track Users across sessions using any persistent identifier not explicitly consented to for a stated functional purpose
- Sell, license, or transfer any data that could identify or profile an individual User to any third party
- Use User activity data to target advertising to specific individuals

Aggregate analytics — counts, totals, distributions — are permitted provided they cannot be used to identify individuals.

### 2. No Profit Extraction

You must not engage in Profit Extraction. Specifically, You must not:

- Operate a surveillance advertising business using data derived from Users of the Software
- Sell or license User data or behavioral profiles to advertisers, data brokers, or any third party
- Gate any feature of the Software behind payment, subscription, or follower threshold
- Charge for access to a User's own data, insights, or analytics about their own content
- Charge for verification, reach, or algorithmic promotion

This restriction does not prohibit:
- Charging a one-time fee for a native client application
- Accepting voluntary donations or sponsorships from individuals who support the mission
- Charging for infrastructure services to organizations self-hosting a private instance, provided all features remain available to all Users of that instance without additional charge

### 3. No Acquisition for Extraction

You must not sell, transfer, or assign the Software, a Derivative Work, or the organization operating it to any entity whose primary business model involves Profit Extraction or Individual Tracking. This includes:

- Advertising technology companies
- Data brokers
- Surveillance infrastructure providers
- Any entity that would be prohibited from operating the Software under this License

Any transfer of ownership or control must be disclosed publicly to the Community no less than 90 days in advance. The incoming operator must affirm in writing, publicly, that they accept this License in full and will operate under its terms.

### 4. No Closed Forks

You must not create or distribute a Derivative Work that is not fully open source under this License. You must not:

- Take the Software private
- Operate a hosted version while withholding source code
- Combine the Software with proprietary components in a way that makes the combined work effectively closed
- Use technical measures to prevent Users from accessing, auditing, or verifying the source of the software serving them

### 5. No Removal of User Rights

You must not modify the Software to diminish the rights of Users. Specifically, You must not:

- Remove or restrict a User's ability to delete their own account and data
- Remove or restrict access to a User's own insights and analytics
- Add follower gates, engagement thresholds, or account age requirements to any feature
- Remove public read access — content that is public must remain accessible without authentication
- Implement verification systems that require payment

### 6. No Weaponization

You must not deploy the Software or any Derivative Work to:

- Conduct mass surveillance of any population
- Profile individuals for law enforcement purposes without lawful process
- Suppress political speech, journalism, or protected expression through algorithmic means
- Operate on behalf of any entity whose purpose is to harm the people using the platform

---

## Part IV — Community Governance (Recommended Practice)

This section is not legally enforceable but represents the spirit of this License and is expected of any deployment that claims to operate in the Counter tradition.

No significant change to the platform — its direction, core features, policies, or the terms of this License — should be decided by a single individual. Meaningful changes should be:

- Proposed publicly with sufficient notice for community input
- Discussed openly with genuine consideration of community response
- Decided with documented community input, not merely announced

The founder's voice, the maintainer's voice, the largest contributor's voice — these are voices in the community. They are not the community.

---

## Part V — Enforcement and Termination

### Automatic Termination

Your rights under this License terminate automatically and immediately if You:

- Violate any restriction in Part III
- Fail to comply with any condition in Part II and do not remedy the failure within 30 days of written notice

Upon termination, You must immediately cease all use and distribution of the Software and any Derivative Works. Termination does not affect the rights of Users of any deployment You operated prior to termination.

### Cure Period

For violations of Part II (Conditions), You have 30 days from the date You receive written notice of the violation to cure it. If You cure the violation within that period, Your rights are reinstated. No cure period applies to violations of Part III (Restrictions) — those violations terminate rights immediately and permanently.

### Reinstatement

Rights terminated for violation of Part II may be reinstated by the copyright holder if the violation is cured and the copyright holder provides written notice of reinstatement. Rights terminated for violation of Part III are not reinstated under any circumstances.

---

## Part VI — Disclaimer of Warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## Part VII — Limitation of Liability

IN NO EVENT WILL THE COPYRIGHT HOLDER BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES ARISING OUT OF OR IN CONNECTION WITH THIS LICENSE OR THE SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

---

## Part VIII — Interpretation

### Severability
If any provision of this License is found to be unenforceable, that provision shall be modified to the minimum extent necessary to make it enforceable, or if it cannot be made enforceable, it shall be severed from this License. The remainder of the License continues in full force.

### No Waiver
Failure to enforce any provision of this License does not constitute a waiver of that provision or of the rights granted herein.

### Conflict
If there is a conflict between this License and any other agreement You have entered into regarding the Software, this License governs with respect to the rights and restrictions it covers.

### Intent
In all cases of ambiguity, this License shall be interpreted in the manner most consistent with its stated purpose: protecting Users from exploitation, ensuring transparency, and preserving the open and trustworthy character of the Software.

---

## How to Apply This License

Include the following notice in every source file and in a LICENSE file at the root of the repository:

```
Copyright (c) [year] [name]

Licensed under the Counter Social License (CSL) v1.0.
You may use, modify, and distribute this software only in accordance
with the terms of the CSL. The full license text is available at:
https://github.com/counter-ltd/commitment/CSL.md

This software may not be used for individual tracking, profit extraction,
closed-source distribution, or in violation of any restriction in the CSL.
```

---

## A Note on Intent

This license was written because the values behind Counter — openness, privacy, transparency, community — are only meaningful if they are enforceable. A platform that says "we respect your privacy" without legal teeth is just marketing.

The Counter Social License is the legal expression of the same commitment that is signed, dated, and in the repository. It is how those values travel with the code wherever the code goes.

If you are building something you believe in, with nothing to hide, for people you genuinely want to serve — this license costs you nothing. That is exactly who it was written for.

---

*Counter Social License v1.0 — counter.ltd*
*First published June 4th, 2026*
