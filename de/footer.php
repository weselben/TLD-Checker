<footer class="page-footer" style="background-color: #3a3a3a;">
    <div class="container">
        <div class="row">
            <div class="col l6 s12">
                <h5 class="white-text"><a href="https://tld-checker.net">TLD-Checker.net</a></h5>
                <p class="grey-text text-lighten-4">Hey, f&uuml;r die Funktionalit&auml;t dieser Webseite ben&ouml;tigen wir JavaScript, also solltest du ein JavaScript-Blocker benutzen, beschwere dich nicht!</p>
            </div>
            <div class="col l4 offset-l2 s12">
                <h5 class="white-text">Links</h5>
                <ul>
                    <li><a class="grey-text text-lighten-3" href="https://paypal.me/bengotti">Spende</a></li>
                    <li><a class="grey-text text-lighten-3" href="https://github.com/weselben/TLD-Checker">GitHub</a>
                    </li>
                    <li><a class="grey-text text-lighten-3"
                           href="https://github.com/weselben/TLD-Checker/issues">Probleme</a></li>
                    <li><a class="grey-text text-lighten-3" href="../assets/imgs/cs.jpg">Discord</a></li>
                </ul>
            </div>
        </div>
    </div>
    <div class="footer-copyright">
        <div class="container">
            <?php echo "Copyright &copy; 2020-" . date("Y") . " - weselben"; ?> - <a
                    href="https://www.freeprivacypolicy.com/live/ea327286-3518-4036-b560-4c6675a0e0a2">Datenschutzerklärung</a> - <a href="https://tld-checker.net/imprint/">Impressum</a>
            <div class="grey-text text-lighten-4 right">
                <?php
                if (!isset($_SERVER['HTTP_X_FORWARDED_FOR'])) {
                    $client_ip = $_SERVER['REMOTE_ADDR'];
                } else {
                    $client_ip = $_SERVER['HTTP_X_FORWARDED_FOR'];
                }
                if ($client_ip == "127.0.0.1") {
                    $city = "localhost";
                    echo '<a href="https://www.google.com/maps/search/' . $city . '">' . $city . '</a>' . " - " . $client_ip;
                } else {
                    $city = json_decode(file_get_contents("http://ipinfo.io/{$client_ip}/json"));
                    echo '<a href="https://www.google.com/maps/search/' . $city->city . '">' . $city->city . '</a>' . " - " . $client_ip;
                }
                ?>
            </div>
        </div>
    </div>
</footer>