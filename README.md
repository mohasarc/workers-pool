# workers-pool


The `workers-pool` package allows you to easily create a pool of workers, pass them
some heavy tasks in the form of functions, and use them as if they were asynchronous functions.

Important note: This is not yet stable, you may not use it for production!

## Installing the package
```js
npm i workers-pool
```

## Usage

folder structure:

|__ index.js
|__ funcs.js
|__ asyncFuncs.js

```js
// funcs.js
module.exports.add = function (a, b) {
    return a + b;
}
```

```js
// asyncFuncs.js
const path = require('path');
const Pool = require('workers-pool');
const pool = new Pool(5);

module.exports.addAsync = pool.getTaskHandler(path.join(__dirname, 'funcs.js'), 'add');
```

```js
// index.js
const {addAsync} = require('./asyncFuncs');

addAsync.run([2, 5], function (result) {
    console.log(result) // output: 7
});
```
Firstly, the function to be used as the task has to be exported. 
Then, we use the file absolute path with the exported
function name to create a TaskHandler object. This object will hold
information about the task. Finally, the TaskHandler object `addAsync`
can be used to run the task using `run` method.

Another way to run functions on the fly is also available: 

folder structure:

|__ index.js
|__ funcs.js

```js
// funcs.js
module.exports.add = function (a, b) {
    return a + b;
}
```

```js
// index.js
const path = require('path');
const Pool = require('workers-pool');
const pool = new Pool(5);

pool.enqueueTask(path.join(__dirname, 'funcs.js'), 'add', [2, 5], function (result){
    console.log(result) // output: 7
})
```
The first step is the same. We'd also skip over the second step and
jump directly to the third step, but instead of calling `run` method
on TaskHandler object, we'd directly enqueue the function using 
`pool.enqueueTask` method of pool class.