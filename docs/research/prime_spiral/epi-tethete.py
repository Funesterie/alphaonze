#!/usr/bin/env python3
"""L'epi tethete — regle de departage du rotator, et sa mesure.

Voir EPI_TETHETE_2026-08-19.md. Ce script produit le tableau du paragraphe 5.
"""


def est_premier(n):
    """Miller-Rabin deterministe sous 3,2e9 avec les bases 2, 3, 5, 7."""
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for a in (2, 3, 5, 7):
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = x * x % n
            if x == n - 1:
                break
        else:
            return False
    return True


def voisins(x):
    """Les premiers encadrant x. Borne a 2: sous 2 il n'y en a pas, et la
    recherche descendrait indefiniment (le cas se presente des k=1, ou S vaut 1)."""
    if x <= 2:
        return 2, 2
    if est_premier(x):
        return x, x
    bas = x - 1
    while bas > 2 and not est_premier(bas):
        bas -= 1
    haut = x + 1
    while not est_premier(haut):
        haut += 1
    return bas, haut


def non_premiers(limite):
    """La suite C: 1, puis les composes."""
    crible = bytearray([1]) * (limite + 1)
    crible[0] = crible[1] = 0
    for i in range(2, int(limite ** 0.5) + 1):
        if crible[i]:
            crible[i * i::i] = bytearray(len(crible[i * i::i]))
    return [1] + [i for i in range(2, limite + 1) if not crible[i]]


def marche(C, N, regle):
    """Somme alternee des Delta sur N termes. Renvoie (|A|max, A final, egalites, S)."""
    S = A = pire = egalites = 0
    signe = 1
    for k in range(N):
        S += C[k]
        bas, haut = voisins(S)
        d_bas, d_haut = S - bas, haut - S
        if d_bas < d_haut:
            P = bas
        elif d_haut < d_bas:
            P = haut
        else:
            # L'egalite: le seul endroit ou le choix est libre.
            egalites += 1
            if regle == 'plus-petit':
                P = bas
            else:
                # L'epi tethete: prendre le premier qui ramene A vers zero.
                P = min((abs(A + signe * (S - c)), c) for c in (bas, haut))[1]
        A += signe * (S - P)
        signe = -signe
        pire = max(pire, abs(A))
    return pire, A, egalites, S


if __name__ == '__main__':
    C = non_premiers(25000)
    print(f"{'N':>7} {'regle':<16} {'|A|max':>8} {'A final':>9} {'egalites':>9} {'S atteint':>12}")
    for N in (40, 200, 1000, 5000, 20000):
        for regle in ('plus-petit', 'epi-tethete'):
            pire, A, eg, S = marche(C, N, regle)
            print(f"{N:>7} {regle:<16} {pire:>8} {A:>9} {eg:>9} {S:>12}")
        print()
