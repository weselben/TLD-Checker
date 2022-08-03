<script type="text/javascript">
    fetch('https://dns.google/resolve?name=<?php echo $fulldomain ?>').then(function (response) {
        response.text().then(function (text) {
            var outputjsp = JSON.parse(text);
            var resp = outputjsp.Status
            if (resp == "0") {

                function aihtml() {

                    var ul = document.getElementById("inuse");
                    var td = document.createElement("li");
                    td.appendChild(document.createTextNode(<a href='<?php echo $fulldomain ?>'>"❌ - <?php echo $fulldomain ?>"<a>));
                    ul.appendChild(td);
                }

                aihtml()
            } else {

                function aihtml() {

                    var ul = document.getElementById("avail");
                    var td = document.createElement("li");
                    td.appendChild(document.createTextNode("✔️ - <?php echo $fulldomain ?>"));
                    ul.appendChild(td);
                }

                aihtml()
            }
        });
    });
</script>
