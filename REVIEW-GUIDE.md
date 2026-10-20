# Dispatch: final peek edge and local-main checkpoint

Open **`570f897 → HEAD`**. Native feedback confirmed: **“great. jumps are smooth AF.”** The remaining screenshot showed the upper comment peek with a top border but no bottom border.

The real card's lower border was outside its clipped preview. A non-interactive border now follows the actual clipped bottom edge, with the same rounded lower corners. It does not add another card or preview, change geometry or scrolling, or cover controls. Hover color follows the original card.

Please look at the upper peek's bottom outline and corners. Click it to reveal the same real card, and check ordinary scrolling and source jumps remain smooth.

The full gate, browser regression (including the new clipped-edge assertion and unchanged pinned/flow motion checks), and native build run before handoff. This is a local-main checkpoint authorised by Alex: Dispatch and Ferropi feature commits are folded into their respective local main branches, without pushing. Uncommitted Pi Durable research scratch remains untouched.

**⌘S / Ctrl-S** submits explicit feedback after saving unfinished comments. A tracked CLI waiter is registered before opening the native GUI.
