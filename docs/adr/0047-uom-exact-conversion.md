# ADR 0047: Exact UOM conversion

Quantities use `numeric(20,6)`. Conversion ratios are positive integer numerator/denominator pairs and may only connect UOMs in the same category. API quantities are decimal strings. The server rejects results that exceed item precision; clients never calculate authoritative quantities.
