// Polyfills pour les méthodes modernes si besoin (pour Vite/TS)
if (!Array.prototype.includes) {
  Array.prototype.includes = function <T>(this: T[], searchElement: T, fromIndex?: number) {
    return this.indexOf(searchElement, fromIndex) !== -1;
  };
}
if (!Array.prototype.flat) {
  Array.prototype.flat = function <A, D extends number = 1>(this: A, depth?: D) {
    var flattend: FlatArray<A, D>[] = [];
    (function flat(arr: any[], d: number | undefined) {
      for (var i = 0; i < arr.length; i++) {
        if (Array.isArray(arr[i]) && (d > 0 || d === undefined)) {
          flat(arr[i], d === undefined ? 1 : d - 1);
        } else {
          flattend.push(arr[i] as FlatArray<A, D>);
        }
      }
    })(Array.isArray(this) ? this : [this], isNaN(depth as number) ? 1 : Number(depth));
    return flattend;
  };
}
// Polyfill Object.entries
if (!Object.entries) {
  Object.entries = function(obj) {
    var ownProps = Object.keys(obj), i = ownProps.length, resArray = new Array(i);
    while (i--)
      resArray[i] = [ownProps[i], obj[ownProps[i]]];
    return resArray;
  };
}
