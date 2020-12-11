# workers-pool


The `workers-pool` package allows you to easily create a pool of workers, pass them
some heavy tasks in the form of functions, and use them as if they were asynchronous functions.

Important note: This is not yet stable, you may not use it for production!

## Installing the package
```js
npm i workers-pool
```

## Usage

```js
const Pool = require('workers-pool');
const pool = new Pool(5);

module.exports.add = function (a, b) {
    return a + b;
}

var addAsync = pool.getTaskHandler(__filename, 'add');

addAsync.run([2, 5], function (result) {
    console.log(result) // 7
});
```
Firstly, the function to be used as the task has to be exported or 
stringifiable. Then, we use the file absolute path with the exported
function name to create a TaskHandler object. This object will hold
information about the task. Finally, the TaskHandler object `addAsync`
can be used to run the task using `run` method.

Another way to run functions on the fly is also available: 

```js
const Pool = require('workers-pool');
const pool = new Pool(5);

module.exports.add = function (a, b) {
    return a + b;
}

pool.enqueueTask(__filename, 'add', [2, 5], function (){
    console.log(result) // 7
})
```
The first step is the same. We'd also skip over the second step and
jump directly to the third step, but instead of calling `run` method
on TaskHandler object, we'd directly enqueue the function using 
`pool.enqueueTask` method of pool class.