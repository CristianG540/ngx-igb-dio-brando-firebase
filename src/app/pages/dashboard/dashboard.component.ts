import { Component, ChangeDetectionStrategy, OnInit } from '@angular/core';

//Services
import { VendedorService } from "../../@core/data/vendedor/vendedor.service";

@Component({
  selector: 'ngx-dashboard',
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnInit {

  constructor (
    private vendedoresService: VendedorService
  ){}

  ngOnInit(){
    this.vendedoresService.getAllVendedores().then( res => {
      console.log("PERRRRROOOOO", res);
    }).catch( err => {
      console.error("La puta madre no funciona", err)
    })
  }

}
