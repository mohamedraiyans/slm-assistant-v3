"""Arabic normalization for *matching* recited words, never for display.

The canonical text is fully vowelled, while speech recognition output may or may not
carry vowel marks and routinely differs in orthographic detail that has nothing to do
with whether the right word was recited (which hamza seat, a dagger alef versus a full
one). Both sides go through the same function, so those differences can't register as
recitation mistakes.

Code points are written as numbers on purpose: most of these are combining marks that
render invisibly (or merge with a neighbouring quote) when written as literals.
"""

import re
import unicodedata


def _span(first: int, last: int) -> str:
    return f"{re.escape(chr(first))}-{re.escape(chr(last))}"


# Harakat and Quranic annotation signs: small high letters, combining vowel marks, the
# superscript (dagger) alef, small signs and waqf (pause) marks, plus tatweel, the
# elongation stroke.
_MARKS = re.compile(
    "["
    + _span(0x0610, 0x061A)  # small high ligatures and signs
    + _span(0x064B, 0x065F)  # fathatan ... wavy hamza below
    + re.escape(chr(0x0670))  # superscript (dagger) alef
    + _span(0x06D6, 0x06ED)  # small high signs, waqf marks
    + re.escape(chr(0x0640))  # tatweel
    + "]"
)

_ALEF = chr(0x0627)
_YA = chr(0x064A)
_LETTER_FOLDS = str.maketrans(
    {
        chr(0x0623): _ALEF,  # alef with hamza above
        chr(0x0625): _ALEF,  # alef with hamza below
        chr(0x0622): _ALEF,  # alef with madda above
        chr(0x0671): _ALEF,  # alef wasla
        chr(0x0649): _YA,  # alef maqsura
        chr(0x0629): chr(0x0647),  # ta marbuta -> ha
        chr(0x0624): chr(0x0648),  # waw with hamza above -> waw
        chr(0x0626): _YA,  # ya with hamza above
        chr(0x0621): None,  # standalone hamza, often not written at all
    }
)

# Anything outside the basic Arabic letters (hamza 0621 .. ya 064A) after folding.
_NOT_ARABIC_LETTER = re.compile("[^" + _span(0x0621, 0x064A) + "]")


def normalize_word(word: str) -> str:
    """Returns the matching key for a word, or "" for tokens that aren't spoken words."""
    # NFC first, so a decomposed hamza or madda from recognition output composes into
    # the same precomposed letter the canonical text uses before it is folded.
    text = unicodedata.normalize("NFC", word)
    text = _MARKS.sub("", text)
    text = text.translate(_LETTER_FOLDS)
    return _NOT_ARABIC_LETTER.sub("", text)
